/**
 * 익스텐션 수명주기 내에서 인증 상태를 관리하는 매니저.
 *
 * - SecretStorage 기반 토큰 / 라이선스키 / 이메일 저장·복원
 * - 상태 변경 이벤트 발행 (UI 갱신 트리거)
 * - Heartbeat 30분 주기 타이머
 * - Jira API Token 기반 인증 (Settings → /myself 검증 → 라이선스 활성화)
 */

import * as vscode from 'vscode';
import {
    LicenseClient,
    LicenseInfo,
    LicenseServerError,
} from './licenseClient';
import { getTrackerConfig } from './config';
import { JiraTrackerAdapter } from './adapters/JiraTrackerAdapter';

// ── SecretStorage 키 상수 ───────────────────────────────

const SECRET_KEYS = {
    JWT_TOKEN: 'universalAgent.jwtToken',
    LICENSE_KEY: 'universalAgent.licenseKey',
    USER_EMAIL: 'universalAgent.userEmail',
} as const;

// ── Heartbeat 간격 (30분) ───────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1_000;

// ── 인증 상태 타입 ──────────────────────────────────────

export type AuthStatus =
    | 'authenticated'
    | 'unauthenticated'
    | 'checking'
    | 'error';

// ── LicenseManager 클래스 ───────────────────────────────

export class LicenseManager implements vscode.Disposable {
    private _status: AuthStatus = 'unauthenticated';
    private _licenseInfo: LicenseInfo | null = null;
    private _token: string | null = null;
    private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    // 상태 변경 이벤트 (UI 갱신 트리거)
    private _onDidChangeAuth = new vscode.EventEmitter<AuthStatus>();
    public readonly onDidChangeAuth = this._onDidChangeAuth.event;

    constructor(
        private readonly secrets: vscode.SecretStorage,
        private readonly client: LicenseClient,
        private readonly machineId: string,
        private readonly extensionVersion: string,
    ) {}

    // ── Getters ──

    /** 인증 상태 */
    get status(): AuthStatus {
        return this._status;
    }

    /** 인증 여부 (boolean shorthand) */
    get isAuthenticated(): boolean {
        return this._status === 'authenticated';
    }

    /** 현재 라이선스 정보 */
    get licenseInfo(): LicenseInfo | null {
        return this._licenseInfo;
    }

    /** 현재 플랜 이름 */
    get planName(): string {
        return this._licenseInfo?.plan.name ?? 'none';
    }

    // ── 초기화 ──

    /**
     * 익스텐션 활성화 시 호출.
     * 1) SecretStorage에서 기존 토큰 복원 시도
     * 2) 토큰 있으면 → verifyLicense()
     * 3) 토큰 없으면 → 비인증 상태 유지
     */
    async initialize(): Promise<void> {
        this.setStatus('checking');

        try {
            const savedToken = await this.secrets.get(SECRET_KEYS.JWT_TOKEN);
            const savedKey = await this.secrets.get(SECRET_KEYS.LICENSE_KEY);

            if (savedToken && savedKey) {
                this._token = savedToken;

                // 저장된 라이선스 키로 서버 검증 시도
                const result = await this.client.verifyLicense(savedKey, this.machineId);

                if (result.valid) {
                    this._licenseInfo = {
                        valid: true,
                        key: savedKey,
                        plan: result.plan ?? { name: 'free', features: {}, limits: {} },
                        expiresAt: null,
                    };
                    this.setStatus('authenticated');
                    this.startHeartbeat();
                    return;
                }

                // 검증 실패 → 토큰 폐기
                await this.clearSecrets();
            }

            // 토큰 없음 → Jira 설정이 있으면 자동 인증 시도
            try {
                const config = getTrackerConfig();
                if (config.domain && config.email && config.apiToken) {
                    const success = await this.login();
                    if (success) { return; }
                }
            } catch {
                // Jira 설정 미완료 → 비인증 상태 유지
            }

            this.setStatus('unauthenticated');
        } catch (err) {
            console.warn('[LicenseManager] 초기화 중 오류:', err);
            // 네트워크 에러 등 → 저장된 토큰이 있으면 임시 허용(Graceful Degradation)
            const savedToken = await this.secrets.get(SECRET_KEYS.JWT_TOKEN);
            if (savedToken) {
                this._token = savedToken;
                this.setStatus('authenticated');
                console.info('[LicenseManager] 오프라인 모드: 캐시된 토큰 기반 임시 허용');
            } else {
                this.setStatus('error');
            }
        }
    }

    // ── 로그인 ──

    /**
     * Jira Settings 기반 인증.
     * Settings의 email/apiToken으로 Jira /myself 호출 → 성공 시 라이선스 활성화.
     * InputBox 없이 자동 인증.
     *
     * @returns 성공 여부
     */
    async login(): Promise<boolean> {
        // 1) Settings에서 Jira 설정 읽기
        let config;
        try {
            config = getTrackerConfig();
        } catch {
            vscode.window.showErrorMessage(
                'Jira 설정을 먼저 완료해 주세요. (Settings → jiraDomain, email, apiToken)'
            );
            await vscode.commands.executeCommand('workbench.action.openSettings', 'universalAgent');
            return false;
        }

        // 2) Jira /myself 호출로 API Token 유효성 검증
        this.setStatus('checking');
        try {
            const adapter = new JiraTrackerAdapter(config);
            const me = await adapter.getMyself();

            // 3) 라이선스 서버에 활성화 요청 (비밀번호 없이!)
            const result = await this.client.activate({
                email: config.email,
                jiraDomain: config.domain,
                jiraAccountId: me.accountId,
                vscodeMachineId: this.machineId,
                extensionVersion: this.extensionVersion,
            });

            // 4) SecretStorage에 저장
            await this.secrets.store(SECRET_KEYS.JWT_TOKEN, result.token);
            await this.secrets.store(SECRET_KEYS.LICENSE_KEY, result.license.key);
            await this.secrets.store(SECRET_KEYS.USER_EMAIL, result.user.email);

            this._token = result.token;
            this._licenseInfo = result.license;
            this.setStatus('authenticated');
            this.startHeartbeat();

            vscode.window.showInformationMessage(
                `✅ 인증 완료! (${me.displayName} — ${result.license.plan.name} 플랜)`
            );
            return true;
        } catch (err) {
            this.setStatus('error');
            const message = err instanceof LicenseServerError
                ? `인증 실패: ${err.message}`
                : err instanceof Error
                    ? `인증 실패: ${err.message}`
                    : '인증 실패: 알 수 없는 오류';
            vscode.window.showErrorMessage(message);
            return false;
        }
    }

    // ── 로그아웃 ──

    /**
     * 로그아웃 → SecretStorage 토큰 삭제 + 상태 초기화
     */
    async logout(): Promise<void> {
        await this.clearSecrets();
        this._token = null;
        this._licenseInfo = null;
        this.stopHeartbeat();
        this.setStatus('unauthenticated');

        vscode.window.showInformationMessage('🔓 로그아웃 되었습니다.');
    }

    // ── 기능 사용량 체크 (🟡 권장) ──

    /**
     * AI 기능 사용 전 호출하여 사용량을 체크.
     * 초과 시 업그레이드 안내 메시지 표시.
     *
     * @param feature 기능 식별자 (예: 'ai_summary', 'auto_report')
     * @returns 사용 가능 여부
     */
    async checkFeatureUsage(feature: string): Promise<boolean> {
        if (!this._token) {
            vscode.window.showWarningMessage(
                '로그인이 필요합니다. Command Palette에서 "Jira Agent: 로그인"을 실행하세요.',
            );
            return false;
        }

        try {
            const result = await this.client.trackUsage(this._token, feature);

            if (!result.tracked) {
                return false;
            }

            if (result.remaining !== null && result.remaining <= 0) {
                const upgrade = '업그레이드';
                const choice = await vscode.window.showWarningMessage(
                    `🚫 ${feature} 사용량이 초과되었습니다. (${result.used}/${result.limit}) 플랜 업그레이드를 검토해 주세요.`,
                    upgrade,
                );
                if (choice === upgrade) {
                    // 라이선스 서버 대시보드로 안내
                    const config = vscode.workspace.getConfiguration('universalAgent');
                    const serverUrl = config.get<string>('licenseServerUrl', 'http://localhost:3000');
                    vscode.env.openExternal(vscode.Uri.parse(`${serverUrl}/dashboard`));
                }
                return false;
            }

            return true;
        } catch (err) {
            // 네트워크 에러 시 허용 (Graceful Degradation)
            console.warn(`[LicenseManager] 사용량 체크 실패 (${feature}):`, err);
            return true;
        }
    }

    // ── Heartbeat (🟢 선택) ──

    /**
     * Heartbeat 타이머 시작 (30분 간격)
     */
    private startHeartbeat(): void {
        this.stopHeartbeat();

        this._heartbeatTimer = setInterval(async () => {
            if (!this._token || !this._licenseInfo?.key) { return; }

            try {
                const result = await this.client.heartbeat(
                    this._token,
                    this._licenseInfo.key,
                    this.machineId,
                );

                if (!result.valid) {
                    console.warn('[LicenseManager] Heartbeat: 라이선스 무효화됨');
                    await this.logout();
                    vscode.window.showWarningMessage(
                        '⚠️ 라이선스가 만료되었거나 무효화되었습니다. 다시 로그인해 주세요.',
                    );
                }
            } catch (err) {
                console.warn('[LicenseManager] Heartbeat 실패:', err);
                // 네트워크 에러→ 무시 (Graceful Degradation)
            }
        }, HEARTBEAT_INTERVAL_MS);
    }

    /**
     * Heartbeat 타이머 정지
     */
    private stopHeartbeat(): void {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
    }

    // ── Private Helpers ──

    private setStatus(status: AuthStatus): void {
        this._status = status;
        this._onDidChangeAuth.fire(status);
    }

    private async clearSecrets(): Promise<void> {
        await this.secrets.delete(SECRET_KEYS.JWT_TOKEN);
        await this.secrets.delete(SECRET_KEYS.LICENSE_KEY);
        await this.secrets.delete(SECRET_KEYS.USER_EMAIL);
    }

    // ── Disposable ──

    dispose(): void {
        this.stopHeartbeat();
        this._onDidChangeAuth.dispose();
    }
}
