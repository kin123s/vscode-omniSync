import * as vscode from 'vscode';
import { waitForOAuthCallback, generateState } from './oauthCallbackServer';
import { getLicenseServerUrl } from './config';

// ── 상수 ──

/** Atlassian OAuth 2.0 Client ID (공개값, Secret은 서버에서만 관리) */
const OAUTH_CLIENT_ID = 'g5t47fmNlkrQIxLnvLTyWDKc1DMeoYln';
const OAUTH_REDIRECT_URI = 'http://localhost:8765/callback';
/** 필요한 Jira 권한 스코프 */
const OAUTH_SCOPES = 'read:jira-work write:jira-work read:jira-user offline_access';

/** SecretStorage 키 */
const SECRET_ACCESS_TOKEN = 'jira.access_token';
const SECRET_ACCOUNT_EMAIL = 'jira.account_email';
const SECRET_ACCOUNT_ID = 'jira.account_id';
const SECRET_DOMAIN = 'jira.cloud_domain';
const SECRET_REFRESH_TOKEN = 'jira.refresh_token';

/** 서버에서 반환하는 토큰 교환 응답 */
interface OAuthExchangeResponse {
    accessToken: string;
    refreshToken?: string;
    email: string;
    accountId: string;
    cloudId: string;
    domain: string;
}

/** 저장된 인증 정보 */
export interface OAuthCredentials {
    accessToken: string;
    email: string;
    accountId: string;
    domain: string;
}

/**
 * Atlassian OAuth 2.0 (3LO) 인증 흐름을 관리하는 매니저.
 *
 * - Client Secret은 절대 번들에 포함하지 않음 → 라이선스 서버가 토큰 교환을 대리
 * - Access Token은 SecretStorage(OS 키체인)에 저장
 * - 토큰 만료 시 자동 재인증 팝업 기능 포함
 */
export class OAuthManager {
    constructor(private readonly secrets: vscode.SecretStorage) {}

    // ── Public API ──

    /**
     * Cloud OAuth 로그인 흐름 실행.
     * 브라우저를 열어 사용자 승인을 기다린 뒤 라이선스 서버를 통해 Access Token을 교환한다.
     */
    async login(): Promise<boolean> {
        const state = generateState();

        const authUrl = new URL('https://auth.atlassian.com/authorize');
        authUrl.searchParams.set('audience', 'api.atlassian.com');
        authUrl.searchParams.set('client_id', OAUTH_CLIENT_ID);
        authUrl.searchParams.set('scope', OAUTH_SCOPES);
        authUrl.searchParams.set('redirect_uri', OAUTH_REDIRECT_URI);
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('prompt', 'consent');

        // 브라우저 오픈
        await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));

        vscode.window.showInformationMessage(
            '🔐 브라우저에서 Atlassian 계정으로 로그인하세요. (최대 2분 대기)',
        );

        try {
            // 콜백 서버가 authorization code 수신 대기
            const { code } = await waitForOAuthCallback(state);

            // 라이선스 서버에 토큰 교환 위임 (Client Secret은 서버에만 있음)
            const data = await this._exchangeCode(code);

            // SecretStorage에 저장
            await this.secrets.store(SECRET_ACCESS_TOKEN, data.accessToken);
            await this.secrets.store(SECRET_ACCOUNT_EMAIL, data.email);
            await this.secrets.store(SECRET_ACCOUNT_ID, data.accountId);
            await this.secrets.store(SECRET_DOMAIN, data.domain);
            if (data.refreshToken) {
                await this.secrets.store(SECRET_REFRESH_TOKEN, data.refreshToken);
            }

            vscode.window.showInformationMessage(
                `✅ Jira Cloud 연결 완료! (${data.email})`,
            );
            return true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : '알 수 없는 오류';
            vscode.window.showErrorMessage(`OAuth 인증 실패: ${msg}`);
            return false;
        }
    }

    /**
     * 저장된 인증 정보를 반환한다.
     * 토큰이 없으면 null 반환 → 호출자가 login()을 트리거해야 함.
     */
    async getCredentials(): Promise<OAuthCredentials | null> {
        const accessToken = await this.secrets.get(SECRET_ACCESS_TOKEN);
        const email = await this.secrets.get(SECRET_ACCOUNT_EMAIL);
        const accountId = await this.secrets.get(SECRET_ACCOUNT_ID);
        const domain = await this.secrets.get(SECRET_DOMAIN);

        if (!accessToken || !email || !domain) { return null; }
        return { accessToken, email, accountId: accountId ?? '', domain };
    }

    /**
     * 로그아웃: SecretStorage에서 모든 OAuth 토큰 삭제
     */
    async logout(): Promise<void> {
        await this.secrets.delete(SECRET_ACCESS_TOKEN);
        await this.secrets.delete(SECRET_ACCOUNT_EMAIL);
        await this.secrets.delete(SECRET_ACCOUNT_ID);
        await this.secrets.delete(SECRET_DOMAIN);
        await this.secrets.delete(SECRET_REFRESH_TOKEN);
    }

    /**
     * Access Token 존재 여부로 인증 상태를 확인한다.
     * (토큰 유효성은 Jira API 호출 시 401 응답으로 감지)
     */
    async isAuthenticated(): Promise<boolean> {
        const token = await this.secrets.get(SECRET_ACCESS_TOKEN);
        return !!token;
    }

    // ── Private ──

    /** 라이선스 서버에 authorization code → Access Token 교환을 위임 */
    private async _exchangeCode(code: string): Promise<OAuthExchangeResponse> {
        const serverUrl = getLicenseServerUrl();
        const response = await fetch(`${serverUrl}/api/v1/auth/oauth/exchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code,
                redirectUri: OAUTH_REDIRECT_URI,
            }),
            signal: AbortSignal.timeout(15_000),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`토큰 교환 실패 (${response.status}): ${text}`);
        }

        return response.json() as Promise<OAuthExchangeResponse>;
    }
}
