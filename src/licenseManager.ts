/**
 * Extension licensing manager.
 *
 * - SecretStorage-based token / license key / email management
 * - Auth status change event emission (for UI triggers)
 * - Heartbeat every 30 minutes
 * - Jira API Token-based authentication (Settings → /myself check → license activation)
 */

import * as vscode from 'vscode';
import {
    LicenseClient,
    LicenseInfo,
    LicenseServerError,
} from './licenseClient';
import { getTrackerConfig } from './config';
import { JiraTrackerAdapter } from './adapters/JiraTrackerAdapter';

// ── SecretStorage Keys ──

const SECRET_KEYS = {
    JWT_TOKEN: 'orx.jwtToken',
    LICENSE_KEY: 'orx.licenseKey',
    USER_EMAIL: 'orx.userEmail',
} as const;

// ── Heartbeat Interval (30 minutes) ──

const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1_000;

// ── Auth Status Type ──

export type AuthStatus =
    | 'authenticated'
    | 'unauthenticated'
    | 'checking'
    | 'error';

// ── LicenseManager Class ──

export class LicenseManager implements vscode.Disposable {
    private _status: AuthStatus = 'unauthenticated';
    private _licenseInfo: LicenseInfo | null = null;
    private _token: string | null = null;
    private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    // Auth status change event (for UI triggers)
    private _onDidChangeAuth = new vscode.EventEmitter<AuthStatus>();
    public readonly onDidChangeAuth = this._onDidChangeAuth.event;

    constructor(
        private readonly secrets: vscode.SecretStorage,
        private readonly client: LicenseClient,
        private readonly machineId: string,
        private readonly extensionVersion: string,
    ) {}

    // ── Getters ──

    /** Current auth status */
    get status(): AuthStatus {
        return this._status;
    }

    /** Shorthand boolean for authenticated state */
    get isAuthenticated(): boolean {
        return this._status === 'authenticated';
    }

    /** Current license info */
    get licenseInfo(): LicenseInfo | null {
        return this._licenseInfo;
    }

    /** Current plan name */
    get planName(): string {
        return this._licenseInfo?.plan.name ?? 'none';
    }

    // ── Initialization ──

    /**
     * Called on extension activation.
     * 1) Attempts to restore saved token from SecretStorage
     * 2) If token exists → verifyLicense()
     * 3) If no token → stays unauthenticated
     */
    async initialize(): Promise<void> {
        this.setStatus('checking');

        try {
            const savedToken = await this.secrets.get(SECRET_KEYS.JWT_TOKEN);
            const savedKey = await this.secrets.get(SECRET_KEYS.LICENSE_KEY);

            if (savedToken && savedKey) {
                this._token = savedToken;

                // Verify saved license with server
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

                // Verification failed — clear tokens
                await this.clearSecrets();
            }

            // No token — attempt auto-authentication if Jira settings are present
            try {
                const config = getTrackerConfig();
                if (config.domain && config.email && config.apiToken) {
                    const success = await this.login();
                    if (success) { return; }
                }
            } catch {
                // Jira settings incomplete — stay unauthenticated
            }

            this.setStatus('unauthenticated');
        } catch (err) {
            console.warn('[LicenseManager] Initialization error:', err);
            // Network error? — if saved token exists, use it temporarily (Graceful Degradation)
            const savedToken = await this.secrets.get(SECRET_KEYS.JWT_TOKEN);
            if (savedToken) {
                this._token = savedToken;
                this.setStatus('authenticated');
                console.info('[LicenseManager] Offline mode: using cached token');
            } else {
                this.setStatus('error');
            }
        }
    }

    // ── Login ──

    /**
     * Jira Settings-based authentication.
     * Uses Settings email/apiToken to verify via Jira /myself endpoint,
     * then activates license. No InputBox prompts — fully automatic.
     *
     * @returns Whether login succeeded
     */
    async login(): Promise<boolean> {
        // 1) Read Jira settings
        let config;
        try {
            config = getTrackerConfig();
        } catch {
            vscode.window.showErrorMessage(
                'Please complete Jira settings first (Settings → trackerDomain, email, apiToken).'
            );
            await vscode.commands.executeCommand('workbench.action.openSettings', 'orx');
            return false;
        }

        // 2) Verify API Token via Jira /myself
        this.setStatus('checking');
        try {
            const adapter = new JiraTrackerAdapter(config);
            const me = await adapter.getMyself();

            // 3) Request license activation from server (no serial number needed!)
            const result = await this.client.activate({
                email: config.email,
                jiraDomain: config.domain,
                jiraAccountId: me.accountId,
                vscodeMachineId: this.machineId,
                extensionVersion: this.extensionVersion,
            });

            // 4) Save to SecretStorage
            await this.secrets.store(SECRET_KEYS.JWT_TOKEN, result.token);
            await this.secrets.store(SECRET_KEYS.LICENSE_KEY, result.license.key);
            await this.secrets.store(SECRET_KEYS.USER_EMAIL, result.user.email);

            this._token = result.token;
            this._licenseInfo = result.license;
            this.setStatus('authenticated');
            this.startHeartbeat();

            vscode.window.showInformationMessage(
                `✅ Authenticated! (${me.displayName} — ${result.license.plan.name} plan)`
            );
            return true;
        } catch (err) {
            this.setStatus('error');
            const message = err instanceof LicenseServerError
                ? `Authentication failed: ${err.message}`
                : err instanceof Error
                    ? `Authentication failed: ${err.message}`
                    : 'Authentication failed: Unknown error';
            vscode.window.showErrorMessage(message);
            return false;
        }
    }

    // ── Logout ──

    /**
     * Logout: clear SecretStorage tokens and reset state.
     */
    async logout(): Promise<void> {
        await this.clearSecrets();
        this._token = null;
        this._licenseInfo = null;
        this.stopHeartbeat();
        this.setStatus('unauthenticated');

        vscode.window.showInformationMessage('👋 Logged out successfully.');
    }

    // ── Feature Usage Check (Quota Enforcement) ──

    /**
     * Checks feature usage quota before invoking AI features.
     * Shows upgrade prompt if quota is exceeded.
     *
     * @param feature Feature identifier (e.g. 'ai_summary', 'auto_report')
     * @returns Whether the feature can be used
     */
    async checkFeatureUsage(feature: string): Promise<boolean> {
        if (!this._token) {
            vscode.window.showWarningMessage(
                'Login required. Run "Orx: Login" from the Command Palette.',
            );
            return false;
        }

        try {
            const result = await this.client.trackUsage(this._token, feature);

            if (!result.tracked) {
                return false;
            }

            if (result.remaining !== null && result.remaining <= 0) {
                const upgrade = 'Upgrade';
                const choice = await vscode.window.showWarningMessage(
                    `${feature} usage quota exceeded (${result.used}/${result.limit}). Please consider upgrading your plan.`,
                    upgrade,
                );
                if (choice === upgrade) {
                    // Redirect to license server dashboard
                    const config = vscode.workspace.getConfiguration('orx');
                    const serverUrl = config.get<string>('licenseServerUrl', 'http://localhost:3000');
                    vscode.env.openExternal(vscode.Uri.parse(`${serverUrl}/dashboard`));
                }
                return false;
            }

            return true;
        } catch (err) {
            // Network error — allow usage (Graceful Degradation)
            console.warn(`[LicenseManager] Usage check failed (${feature}):`, err);
            return true;
        }
    }

    // ── Heartbeat (Periodic Health Check) ──

    /**
     * Starts the heartbeat timer (30-minute interval).
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
                    console.warn('[LicenseManager] Heartbeat: license invalidated');
                    await this.logout();
                    vscode.window.showWarningMessage(
                        '⚠️ Your license has expired or been invalidated. Please log in again.',
                    );
                }
            } catch (err) {
                console.warn('[LicenseManager] Heartbeat failed:', err);
                // Network error — ignore (Graceful Degradation)
            }
        }, HEARTBEAT_INTERVAL_MS);
    }

    /**
     * Stops the heartbeat timer.
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
