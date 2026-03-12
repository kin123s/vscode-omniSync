import * as vscode from 'vscode';

/**
 * 경량 i18n 유틸리티 모듈.
 *
 * VS Code의 언어 설정(`vscode.env.language`)에 따라
 * 적합한 문자열을 반환한다.
 *
 * 지원 언어: 영어(기본), 한국어(ko)
 * 추가 언어가 필요하면 MESSAGES에 로케일 블록을 추가한다.
 */

type MessageKey =
    | 'tree.status.loggedIn'
    | 'tree.status.loggedOut'
    | 'tree.myIssues'
    | 'tree.myFilters'
    | 'tree.querySearch'
    | 'tree.jqlSearch'
    | 'tree.trackingSession'
    | 'tree.login.email'
    | 'tree.login.domain'
    | 'tree.filter.prefix'
    | 'tree.issue.noIssues'
    | 'tree.issue.loadFailed'
    | 'tree.platform.label'
    | 'tree.login.action'
    | 'tracking.status.active'
    | 'tracking.status.inactive';

const MESSAGES: Record<string, Record<MessageKey, string>> = {
    en: {
        'tree.status.loggedIn': '$(check) Connected',
        'tree.status.loggedOut': '$(warning) Not Connected',
        'tree.myIssues': '📋 My Issues (Assigned)',
        'tree.myFilters': '⭐ My Filters',
        'tree.querySearch': '🔍 Search Issues',
        'tree.jqlSearch': '🔍 JQL Search',
        'tree.trackingSession': '🔴 Tracking Session',
        'tree.login.email': 'Email',
        'tree.login.domain': 'Domain',
        'tree.filter.prefix': 'Filter',
        'tree.issue.noIssues': '(No issues)',
        'tree.issue.loadFailed': '⚠️ Failed to load',
        'tree.platform.label': '🔌 Platform',
        'tree.login.action': '🔑 Sign In',
        'tracking.status.active': '🔴 Tracking Active',
        'tracking.status.inactive': '⚫ Not Tracking',
    },
    ko: {
        'tree.status.loggedIn': '$(check) 연결됨',
        'tree.status.loggedOut': '$(warning) 연결 안 됨',
        'tree.myIssues': '📋 내 이슈 (담당)',
        'tree.myFilters': '⭐ 내 필터',
        'tree.querySearch': '🔍 이슈 검색',
        'tree.jqlSearch': '🔍 JQL 검색',
        'tree.trackingSession': '🔴 추적 세션',
        'tree.login.email': '이메일',
        'tree.login.domain': '도메인',
        'tree.filter.prefix': '필터',
        'tree.issue.noIssues': '(이슈 없음)',
        'tree.issue.loadFailed': '⚠️ 로드 실패',
        'tree.platform.label': '🔌 플랫폼',
        'tree.login.action': '🔑 로그인',
        'tracking.status.active': '🔴 추적 중',
        'tracking.status.inactive': '⚫ 추적 안 함',
    },
};

/**
 * 현재 VS Code UI 언어에 맞는 메시지를 반환한다.
 * 지원하지 않는 언어는 영어로 fallback.
 */
export function localize(key: MessageKey, defaultValue?: string): string {
    const lang = vscode.env.language?.split('-')[0] ?? 'en';
    const bundle = MESSAGES[lang] ?? MESSAGES['en'];
    return bundle[key] ?? defaultValue ?? key;
}
