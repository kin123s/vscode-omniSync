import * as vscode from 'vscode';

/**
 * Orx Orchestrator configuration module.
 * Reads tracker-specific settings from VS Code Settings and returns them.
 * Currently supports Jira; GitHub/Linear to be added later.
 */

export type TrackerPlatform = 'jira-cloud' | 'jira-server' | 'github' | 'linear';

export interface TrackerConfig {
    platform: TrackerPlatform;
    domain: string;
    email: string;
    apiToken: string;
    llmApiKey: string;
    oauthAccessToken?: string; // OAuth platform (jira-cloud) only
    /** MISSION-1.5: Allow self-signed certificates (jira-server environments) */
    allowSelfSignedCert?: boolean;
}

/**
 * Reads tracker-specific configuration values from VS Code Settings.
 * For server-token platforms (jira-server, github, linear), domain/apiToken are required.
 */
export function getTrackerConfig(): TrackerConfig {
    const config = vscode.workspace.getConfiguration('orx');

    let domain = config.get<string>('trackerDomain', '').trim();
    // Strip protocol prefix and trailing slashes if entered as URL
    domain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');

    const email = config.get<string>('email', '').trim();
    const apiToken = config.get<string>('apiToken', '').trim();
    const llmApiKey = config.get<string>('llmApiKey', '').trim();
    const platform = getPlatform();

    if (platform !== 'jira-cloud' && (!domain || !apiToken)) {
        throw new Error(
            'Orx settings are incomplete. Please enter trackerDomain and apiToken in Settings.'
        );
    }

    return { platform, domain, email, apiToken, llmApiKey, allowSelfSignedCert: getAllowSelfSignedCert() };
}

/**
 * Reads the license server URL from Settings.
 * Default: http://localhost:3000 (development)
 */
export function getLicenseServerUrl(): string {
    const config = vscode.workspace.getConfiguration('orx');
    return config
        .get<string>('licenseServerUrl', 'http://localhost:3000')
        .replace(/\/$/, '');
}

/**
 * Returns whether dev mode is enabled. If true, license checks are bypassed.
 */
export function isDevMode(): boolean {
    const config = vscode.workspace.getConfiguration('orx');
    return config.get<boolean>('devMode', false);
}

/**
 * Reads the selected tracker platform from Settings.
 */
export function getPlatform(): TrackerPlatform {
    const config = vscode.workspace.getConfiguration('orx');
    const platform = config.get<string>('trackerPlatform', 'jira-cloud');
    const valid: TrackerPlatform[] = ['jira-cloud', 'jira-server', 'github', 'linear'];
    return valid.includes(platform as TrackerPlatform) ? (platform as TrackerPlatform) : 'jira-cloud';
}

/**
 * MISSION-1.5: Self-signed certificate opt-in flag.
 * For Jira Server/DC environments using self-signed certificates.
 */
export function getAllowSelfSignedCert(): boolean {
    const config = vscode.workspace.getConfiguration('orx');
    return config.get<boolean>('allowSelfSignedCert', false);
}
