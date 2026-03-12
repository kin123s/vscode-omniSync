import * as vscode from 'vscode';

/**
 * OmniSync Orchestrator — 설정값 읽기 모듈.
 * VS Code Settings에서 트래커 연동에 필요한 값을 읽어 반환한다.
 * Jira 외 향후 GitHub, Linear 등의 플랫폼 설정도 이 파일에서 확장한다.
 */

export type TrackerPlatform = 'jira-cloud' | 'jira-server' | 'github' | 'linear';

export interface TrackerConfig {
    platform: TrackerPlatform;
    domain: string;
    email: string;
    apiToken: string;
    llmApiKey: string;
    oauthAccessToken?: string; // OAuth 플랫폼(jira-cloud 등) 사용 시
    /** MISSION-1.5: 자체 서명 인증서(self-signed cert) 허용 여부 (jira-server 환경) */
    allowSelfSignedCert?: boolean;
}

/**
 * 트래커 연동 설정값을 가져온다.
 * server-token 계열 플랫폼(jira-server, github, linear)은 domain/apiToken 필수.
 */
export function getTrackerConfig(): TrackerConfig {
    const config = vscode.workspace.getConfiguration('universalAgent');

    let domain = config.get<string>('trackerDomain', '').trim();
    // URL 형태로 입력했을 경우 프로토콜과 후행 슬래시 제거
    domain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');

    const email = config.get<string>('email', '').trim();
    const apiToken = config.get<string>('apiToken', '').trim();
    const llmApiKey = config.get<string>('llmApiKey', '').trim();
    const platform = getPlatform();

    if (platform !== 'jira-cloud' && (!domain || !apiToken)) {
        throw new Error(
            'OmniSync 설정이 완료되지 않았습니다. Settings에서 trackerDomain과 apiToken을 입력해 주세요.'
        );
    }

    return { platform, domain, email, apiToken, llmApiKey, allowSelfSignedCert: getAllowSelfSignedCert() };
}

/**
 * 라이선스 서버 URL을 Settings에서 가져온다.
 * 기본값: http://localhost:3000 (개발 환경)
 */
export function getLicenseServerUrl(): string {
    const config = vscode.workspace.getConfiguration('universalAgent');
    return config
        .get<string>('licenseServerUrl', 'http://localhost:3000')
        .replace(/\/$/, '');
}

/**
 * 개발 모드 여부. true이면 라이선스 검증을 건너뛴다.
 */
export function isDevMode(): boolean {
    const config = vscode.workspace.getConfiguration('universalAgent');
    return config.get<boolean>('devMode', false);
}

/**
 * 연결할 트래커 플랫폼을 Settings에서 가져온다.
 */
export function getPlatform(): TrackerPlatform {
    const config = vscode.workspace.getConfiguration('universalAgent');
    const platform = config.get<string>('trackerPlatform', 'jira-cloud');
    const valid: TrackerPlatform[] = ['jira-cloud', 'jira-server', 'github', 'linear'];
    return valid.includes(platform as TrackerPlatform) ? (platform as TrackerPlatform) : 'jira-cloud';
}

/**
 * MISSION-1.5: Self-signed 인증서 허용 여부.
 * Jira Server/DC 환경에서 자체 서명 인증서를 사용하는 경우
 * 사용자가 opt-in으로 활성화한다.
 */
export function getAllowSelfSignedCert(): boolean {
    const config = vscode.workspace.getConfiguration('universalAgent');
    return config.get<boolean>('allowSelfSignedCert', false);
}
