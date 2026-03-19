/**
 * ?듭뒪?먯뀡 ?섎챸二쇨린 ?댁뿉???몄쬆 ?곹깭瑜?愿由ы븯??留ㅻ땲?.
 *
 * - SecretStorage 湲곕컲 ?좏겙 / ?쇱씠?좎뒪??/ ?대찓????Β룸났??
 * - ?곹깭 蹂寃??대깽??諛쒗뻾 (UI 媛깆떊 ?몃━嫄?
 * - Heartbeat 30遺?二쇨린 ??대㉧
 * - Jira API Token 湲곕컲 ?몄쬆 (Settings ??/myself 寃利????쇱씠?좎뒪 ?쒖꽦??
 */

import * as vscode from 'vscode';
import {
    LicenseClient,
    LicenseInfo,
    LicenseServerError,
} from './licenseClient';
import { getTrackerConfig } from './config';
import { JiraTrackerAdapter } from './adapters/JiraTrackerAdapter';

// ?? SecretStorage ???곸닔 ???????????????????????????????

const SECRET_KEYS = {
    JWT_TOKEN: 'orx.jwtToken',
    LICENSE_KEY: 'orx.licenseKey',
    USER_EMAIL: 'orx.userEmail',
} as const;

// ?? Heartbeat 媛꾧꺽 (30遺? ???????????????????????????????

const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1_000;

// ?? ?몄쬆 ?곹깭 ?????????????????????????????????????????

export type AuthStatus =
    | 'authenticated'
    | 'unauthenticated'
    | 'checking'
    | 'error';

// ?? LicenseManager ?대옒?????????????????????????????????

export class LicenseManager implements vscode.Disposable {
    private _status: AuthStatus = 'unauthenticated';
    private _licenseInfo: LicenseInfo | null = null;
    private _token: string | null = null;
    private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    // ?곹깭 蹂寃??대깽??(UI 媛깆떊 ?몃━嫄?
    private _onDidChangeAuth = new vscode.EventEmitter<AuthStatus>();
    public readonly onDidChangeAuth = this._onDidChangeAuth.event;

    constructor(
        private readonly secrets: vscode.SecretStorage,
        private readonly client: LicenseClient,
        private readonly machineId: string,
        private readonly extensionVersion: string,
    ) {}

    // ?? Getters ??

    /** ?몄쬆 ?곹깭 */
    get status(): AuthStatus {
        return this._status;
    }

    /** ?몄쬆 ?щ? (boolean shorthand) */
    get isAuthenticated(): boolean {
        return this._status === 'authenticated';
    }

    /** ?꾩옱 ?쇱씠?좎뒪 ?뺣낫 */
    get licenseInfo(): LicenseInfo | null {
        return this._licenseInfo;
    }

    /** ?꾩옱 ?뚮옖 ?대쫫 */
    get planName(): string {
        return this._licenseInfo?.plan.name ?? 'none';
    }

    // ?? 珥덇린????

    /**
     * ?듭뒪?먯뀡 ?쒖꽦?????몄텧.
     * 1) SecretStorage?먯꽌 湲곗〈 ?좏겙 蹂듭썝 ?쒕룄
     * 2) ?좏겙 ?덉쑝硫???verifyLicense()
     * 3) ?좏겙 ?놁쑝硫???鍮꾩씤利??곹깭 ?좎?
     */
    async initialize(): Promise<void> {
        this.setStatus('checking');

        try {
            const savedToken = await this.secrets.get(SECRET_KEYS.JWT_TOKEN);
            const savedKey = await this.secrets.get(SECRET_KEYS.LICENSE_KEY);

            if (savedToken && savedKey) {
                this._token = savedToken;

                // ??λ맂 ?쇱씠?좎뒪 ?ㅻ줈 ?쒕쾭 寃利??쒕룄
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

                // 寃利??ㅽ뙣 ???좏겙 ?먭린
                await this.clearSecrets();
            }

            // ?좏겙 ?놁쓬 ??Jira ?ㅼ젙???덉쑝硫??먮룞 ?몄쬆 ?쒕룄
            try {
                const config = getTrackerConfig();
                if (config.domain && config.email && config.apiToken) {
                    const success = await this.login();
                    if (success) { return; }
                }
            } catch {
                // Jira ?ㅼ젙 誘몄셿猷???鍮꾩씤利??곹깭 ?좎?
            }

            this.setStatus('unauthenticated');
        } catch (err) {
            console.warn('[LicenseManager] 珥덇린??以??ㅻ쪟:', err);
            // ?ㅽ듃?뚰겕 ?먮윭 ??????λ맂 ?좏겙???덉쑝硫??꾩떆 ?덉슜(Graceful Degradation)
            const savedToken = await this.secrets.get(SECRET_KEYS.JWT_TOKEN);
            if (savedToken) {
                this._token = savedToken;
                this.setStatus('authenticated');
                console.info('[LicenseManager] ?ㅽ봽?쇱씤 紐⑤뱶: 罹먯떆???좏겙 湲곕컲 ?꾩떆 ?덉슜');
            } else {
                this.setStatus('error');
            }
        }
    }

    // ?? 濡쒓렇????

    /**
     * Jira Settings 湲곕컲 ?몄쬆.
     * Settings??email/apiToken?쇰줈 Jira /myself ?몄텧 ???깃났 ???쇱씠?좎뒪 ?쒖꽦??
     * InputBox ?놁씠 ?먮룞 ?몄쬆.
     *
     * @returns ?깃났 ?щ?
     */
    async login(): Promise<boolean> {
        // 1) Settings?먯꽌 Jira ?ㅼ젙 ?쎄린
        let config;
        try {
            config = getTrackerConfig();
        } catch {
            vscode.window.showErrorMessage(
                'Jira ?ㅼ젙??癒쇱? ?꾨즺??二쇱꽭?? (Settings ??jiraDomain, email, apiToken)'
            );
            await vscode.commands.executeCommand('workbench.action.openSettings', 'orx');
            return false;
        }

        // 2) Jira /myself ?몄텧濡?API Token ?좏슚??寃利?
        this.setStatus('checking');
        try {
            const adapter = new JiraTrackerAdapter(config);
            const me = await adapter.getMyself();

            // 3) ?쇱씠?좎뒪 ?쒕쾭???쒖꽦???붿껌 (鍮꾨?踰덊샇 ?놁씠!)
            const result = await this.client.activate({
                email: config.email,
                jiraDomain: config.domain,
                jiraAccountId: me.accountId,
                vscodeMachineId: this.machineId,
                extensionVersion: this.extensionVersion,
            });

            // 4) SecretStorage?????
            await this.secrets.store(SECRET_KEYS.JWT_TOKEN, result.token);
            await this.secrets.store(SECRET_KEYS.LICENSE_KEY, result.license.key);
            await this.secrets.store(SECRET_KEYS.USER_EMAIL, result.user.email);

            this._token = result.token;
            this._licenseInfo = result.license;
            this.setStatus('authenticated');
            this.startHeartbeat();

            vscode.window.showInformationMessage(
                `???몄쬆 ?꾨즺! (${me.displayName} ??${result.license.plan.name} ?뚮옖)`
            );
            return true;
        } catch (err) {
            this.setStatus('error');
            const message = err instanceof LicenseServerError
                ? `?몄쬆 ?ㅽ뙣: ${err.message}`
                : err instanceof Error
                    ? `?몄쬆 ?ㅽ뙣: ${err.message}`
                    : '?몄쬆 ?ㅽ뙣: ?????녿뒗 ?ㅻ쪟';
            vscode.window.showErrorMessage(message);
            return false;
        }
    }

    // ?? 濡쒓렇?꾩썐 ??

    /**
     * 濡쒓렇?꾩썐 ??SecretStorage ?좏겙 ??젣 + ?곹깭 珥덇린??
     */
    async logout(): Promise<void> {
        await this.clearSecrets();
        this._token = null;
        this._licenseInfo = null;
        this.stopHeartbeat();
        this.setStatus('unauthenticated');

        vscode.window.showInformationMessage('?뵑 濡쒓렇?꾩썐 ?섏뿀?듬땲??');
    }

    // ?? 湲곕뒫 ?ъ슜??泥댄겕 (?윞 沅뚯옣) ??

    /**
     * AI 湲곕뒫 ?ъ슜 ???몄텧?섏뿬 ?ъ슜?됱쓣 泥댄겕.
     * 珥덇낵 ???낃렇?덉씠???덈궡 硫붿떆吏 ?쒖떆.
     *
     * @param feature 湲곕뒫 ?앸퀎??(?? 'ai_summary', 'auto_report')
     * @returns ?ъ슜 媛???щ?
     */
    async checkFeatureUsage(feature: string): Promise<boolean> {
        if (!this._token) {
            vscode.window.showWarningMessage(
                '濡쒓렇?몄씠 ?꾩슂?⑸땲?? Command Palette?먯꽌 "Jira Agent: 濡쒓렇?????ㅽ뻾?섏꽭??',
            );
            return false;
        }

        try {
            const result = await this.client.trackUsage(this._token, feature);

            if (!result.tracked) {
                return false;
            }

            if (result.remaining !== null && result.remaining <= 0) {
                const upgrade = '?낃렇?덉씠??;
                const choice = await vscode.window.showWarningMessage(
                    `?슟 ${feature} ?ъ슜?됱씠 珥덇낵?섏뿀?듬땲?? (${result.used}/${result.limit}) ?뚮옖 ?낃렇?덉씠?쒕? 寃?좏빐 二쇱꽭??`,
                    upgrade,
                );
                if (choice === upgrade) {
                    // ?쇱씠?좎뒪 ?쒕쾭 ??쒕낫?쒕줈 ?덈궡
                    const config = vscode.workspace.getConfiguration('orx');
                    const serverUrl = config.get<string>('licenseServerUrl', 'http://localhost:3000');
                    vscode.env.openExternal(vscode.Uri.parse(`${serverUrl}/dashboard`));
                }
                return false;
            }

            return true;
        } catch (err) {
            // ?ㅽ듃?뚰겕 ?먮윭 ???덉슜 (Graceful Degradation)
            console.warn(`[LicenseManager] ?ъ슜??泥댄겕 ?ㅽ뙣 (${feature}):`, err);
            return true;
        }
    }

    // ?? Heartbeat (?윟 ?좏깮) ??

    /**
     * Heartbeat ??대㉧ ?쒖옉 (30遺?媛꾧꺽)
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
                    console.warn('[LicenseManager] Heartbeat: ?쇱씠?좎뒪 臾댄슚?붾맖');
                    await this.logout();
                    vscode.window.showWarningMessage(
                        '?좑툘 ?쇱씠?좎뒪媛 留뚮즺?섏뿀嫄곕굹 臾댄슚?붾릺?덉뒿?덈떎. ?ㅼ떆 濡쒓렇?명빐 二쇱꽭??',
                    );
                }
            } catch (err) {
                console.warn('[LicenseManager] Heartbeat ?ㅽ뙣:', err);
                // ?ㅽ듃?뚰겕 ?먮윭??臾댁떆 (Graceful Degradation)
            }
        }, HEARTBEAT_INTERVAL_MS);
    }

    /**
     * Heartbeat ??대㉧ ?뺤?
     */
    private stopHeartbeat(): void {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
    }

    // ?? Private Helpers ??

    private setStatus(status: AuthStatus): void {
        this._status = status;
        this._onDidChangeAuth.fire(status);
    }

    private async clearSecrets(): Promise<void> {
        await this.secrets.delete(SECRET_KEYS.JWT_TOKEN);
        await this.secrets.delete(SECRET_KEYS.LICENSE_KEY);
        await this.secrets.delete(SECRET_KEYS.USER_EMAIL);
    }

    // ?? Disposable ??

    dispose(): void {
        this.stopHeartbeat();
        this._onDidChangeAuth.dispose();
    }
}
