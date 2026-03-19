import * as vscode from 'vscode';

/**
 * Orx Orchestrator ???ㅼ젙媛??쎄린 紐⑤뱢.
 * VS Code Settings?먯꽌 ?몃옒而??곕룞???꾩슂??媛믪쓣 ?쎌뼱 諛섑솚?쒕떎.
 * Jira ???ν썑 GitHub, Linear ?깆쓽 ?뚮옯???ㅼ젙?????뚯씪?먯꽌 ?뺤옣?쒕떎.
 */

export type TrackerPlatform = 'jira-cloud' | 'jira-server' | 'github' | 'linear';

export interface TrackerConfig {
    platform: TrackerPlatform;
    domain: string;
    email: string;
    apiToken: string;
    llmApiKey: string;
    oauthAccessToken?: string; // OAuth ?뚮옯??jira-cloud ?? ?ъ슜 ??
    /** MISSION-1.5: ?먯껜 ?쒕챸 ?몄쬆??self-signed cert) ?덉슜 ?щ? (jira-server ?섍꼍) */
    allowSelfSignedCert?: boolean;
}

/**
 * ?몃옒而??곕룞 ?ㅼ젙媛믪쓣 媛?몄삩??
 * server-token 怨꾩뿴 ?뚮옯??jira-server, github, linear)? domain/apiToken ?꾩닔.
 */
export function getTrackerConfig(): TrackerConfig {
    const config = vscode.workspace.getConfiguration('orx');

    let domain = config.get<string>('trackerDomain', '').trim();
    // URL ?뺥깭濡??낅젰?덉쓣 寃쎌슦 ?꾨줈?좎퐳怨??꾪뻾 ?щ옒???쒓굅
    domain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');

    const email = config.get<string>('email', '').trim();
    const apiToken = config.get<string>('apiToken', '').trim();
    const llmApiKey = config.get<string>('llmApiKey', '').trim();
    const platform = getPlatform();

    if (platform !== 'jira-cloud' && (!domain || !apiToken)) {
        throw new Error(
            'Orx ?ㅼ젙???꾨즺?섏? ?딆븯?듬땲?? Settings?먯꽌 trackerDomain怨?apiToken???낅젰??二쇱꽭??'
        );
    }

    return { platform, domain, email, apiToken, llmApiKey, allowSelfSignedCert: getAllowSelfSignedCert() };
}

/**
 * ?쇱씠?좎뒪 ?쒕쾭 URL??Settings?먯꽌 媛?몄삩??
 * 湲곕낯媛? http://localhost:3000 (媛쒕컻 ?섍꼍)
 */
export function getLicenseServerUrl(): string {
    const config = vscode.workspace.getConfiguration('orx');
    return config
        .get<string>('licenseServerUrl', 'http://localhost:3000')
        .replace(/\/$/, '');
}

/**
 * 媛쒕컻 紐⑤뱶 ?щ?. true?대㈃ ?쇱씠?좎뒪 寃利앹쓣 嫄대꼫?대떎.
 */
export function isDevMode(): boolean {
    const config = vscode.workspace.getConfiguration('orx');
    return config.get<boolean>('devMode', false);
}

/**
 * ?곌껐???몃옒而??뚮옯?쇱쓣 Settings?먯꽌 媛?몄삩??
 */
export function getPlatform(): TrackerPlatform {
    const config = vscode.workspace.getConfiguration('orx');
    const platform = config.get<string>('trackerPlatform', 'jira-cloud');
    const valid: TrackerPlatform[] = ['jira-cloud', 'jira-server', 'github', 'linear'];
    return valid.includes(platform as TrackerPlatform) ? (platform as TrackerPlatform) : 'jira-cloud';
}

/**
 * MISSION-1.5: Self-signed ?몄쬆???덉슜 ?щ?.
 * Jira Server/DC ?섍꼍?먯꽌 ?먯껜 ?쒕챸 ?몄쬆?쒕? ?ъ슜?섎뒗 寃쎌슦
 * ?ъ슜?먭? opt-in?쇰줈 ?쒖꽦?뷀븳??
 */
export function getAllowSelfSignedCert(): boolean {
    const config = vscode.workspace.getConfiguration('orx');
    return config.get<boolean>('allowSelfSignedCert', false);
}
