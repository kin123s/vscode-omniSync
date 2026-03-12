import * as vscode from 'vscode';
import { getTrackerConfig, getLicenseServerUrl, isDevMode, getPlatform } from './config';
import { JiraTrackerAdapter } from './adapters/JiraTrackerAdapter';
import { generateWorkPlan } from './planner';
import { PlannerViewProvider } from './plannerView';
import { MemoryManager } from './memory';
import { Tracker } from './tracker';
import { registerChatParticipant } from './chatParticipant';
import { generateReport, generateSimpleReport } from './reporter';
import { sendLlmRequest } from './llmService';
import { ConnectionManager } from './connectionManager';
import { JiraTreeDataProvider } from './treeView';
import { registerTreeActions } from './treeActions';
import { LicenseClient } from './licenseClient';
import { LicenseManager } from './licenseManager';
import { DashboardPanel } from './issueDashboard';
import { OAuthManager } from './oauthManager';
import { GitDiffCollector } from './collectors/GitDiffCollector';
import { TerminalListener } from './collectors/TerminalListener';
import { ExportManager } from './orchestrator/ExportManager';
import { PayloadBuilder } from './orchestrator/PayloadBuilder';
import { WelcomePanel } from './welcomePanel';
import { ReportPanel } from './ReportPanel';
import type { WebviewToExtMessage } from './webviewProtocol';

// ─── 싱글톤 인스턴스 ───
let plannerView: PlannerViewProvider;
let memoryManager: MemoryManager;
let tracker: Tracker;
let connectionManager: ConnectionManager;
let treeProvider: JiraTreeDataProvider;
let licenseManager: LicenseManager;
// Phase 4: 오케스트레이터 파이프라인 모듈
let gitDiffCollector: GitDiffCollector;
let terminalListener: TerminalListener;
let exportManager: ExportManager;
let payloadBuilder: PayloadBuilder;
let initialized = false;

export async function activate(context: vscode.ExtensionContext) {
    console.log('[OmniSync Orchestrator] 익스텐션이 활성화되었습니다.');

    // ── TreeView 사이드바 초기화 (항상 표시, 인증 여부와 무관) ──
    connectionManager = new ConnectionManager();
    memoryManager = new MemoryManager(context.workspaceState);
    treeProvider = new JiraTreeDataProvider(connectionManager, memoryManager);

    const treeView = vscode.window.createTreeView('universalAgent.issueExplorer', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView, connectionManager);

    // ── 미인증 상태에서도 동작해야 하는 커맨드를 여기서 등록 ──
    context.subscriptions.push(
        vscode.commands.registerCommand('universal-agent.refreshTree', () => {
            connectionManager.checkConnection();
            treeProvider.refresh();
        }),
        vscode.commands.registerCommand('universal-agent.searchIssues', () => {
            vscode.commands.executeCommand('universal-agent.searchJql');
        }),
    );

    // 플랫폼 선택 + 로그인 패널
    const openWelcome = () => {
        WelcomePanel.createOrShow(context, () => {
            connectionManager.checkConnection().then(() => treeProvider.refresh());
        });
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('universal-agent.selectPlatform', openWelcome),
    );

    // 연결 상태 확인 (실패해도 무시 — 설정 미입력 시)
    connectionManager.checkConnection().catch(() => {});

    // ── [DEV MODE] 개발 모드 바이패스 ──
    if (isDevMode()) {
        console.log('⚠️ [DEV MODE] 라이선스 검증 건너뜀 — 모든 기능 활성화');

        // DEV MODE에서도 login → WelcomePanel
        context.subscriptions.push(
            vscode.commands.registerCommand('universal-agent.login', openWelcome),
            vscode.commands.registerCommand('universal-agent.logout', () => {
                vscode.window.showInformationMessage('DEV MODE에서는 로그아웃이 필요 없습니다.');
            }),
        );

        initializeFullFeatures(context);

        const devStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        devStatusBar.text = '$(beaker) DEV MODE';
        devStatusBar.tooltip = 'OmniSync Orchestrator — 개발 모드 (라이선스 검증 건너뜀)';
        devStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        devStatusBar.show();
        context.subscriptions.push(devStatusBar);
        return;
    }

    // ── [LICENSE GATE] 라이선스 검증 게이트 (프로덕션) ──
    const licenseClient = new LicenseClient(getLicenseServerUrl());
    const machineId = vscode.env.machineId;
    licenseManager = new LicenseManager(
        context.secrets,
        licenseClient,
        machineId,
        context.extension.packageJSON.version ?? '0.0.0',
    );

    await licenseManager.initialize();

    // ── 로그인/로그아웃 커맨드 등록 (인증 상태와 무관하게 항상 등록) ──
    context.subscriptions.push(
        vscode.commands.registerCommand('universal-agent.login', async () => {
            const platform = getPlatform();

            if (platform === 'jira-cloud') {
                // Cloud OAuth 2.0 흐름
                const oauthManager = new OAuthManager(context.secrets);
                const success = await oauthManager.login();
                if (success) {
                    vscode.window.showInformationMessage(
                        'Jira Cloud에 연결되었습니다. VS Code를 재시작하거나 창을 새로고침하면 완전히 활성화됩니다.',
                    );
                    connectionManager.checkConnection();
                }
            } else {
                // Server/DC/GitHub/Linear: LicenseManager 기반 인증
                const success = await licenseManager.login();
                if (success) {
                    initializeFullFeatures(context);
                    connectionManager.checkConnection();
                }
            }
        }),
        vscode.commands.registerCommand('universal-agent.logout', async () => {
            await licenseManager.logout();
            vscode.window.showInformationMessage(
                '기능이 비활성화되었습니다. 다시 사용하려면 VS Code를 재시작해 주세요.',
            );
        }),
        licenseManager,
    );

    if (!licenseManager.isAuthenticated) {
        showUnauthenticatedUI(context);
        return;
    }

    initializeFullFeatures(context);
}

/**
 * 비인증 상태 UI: 상태바에 미인증 표시 + 로그인 유도 메시지
 */
function showUnauthenticatedUI(context: vscode.ExtensionContext): void {
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.text = '$(lock) OmniSync: 미인증';
    statusBar.tooltip = '클릭하여 로그인';
    statusBar.command = 'universal-agent.login';
    statusBar.show();
    context.subscriptions.push(statusBar);

    licenseManager.onDidChangeAuth((status) => {
        if (status === 'authenticated') {
            statusBar.text = `$(verified) ${licenseManager.planName} Plan`;
            statusBar.tooltip = 'OmniSync Orchestrator - 인증됨';
            statusBar.command = undefined;
        } else if (status === 'checking') {
            statusBar.text = '$(sync~spin) OmniSync: 확인 중...';
        } else {
            statusBar.text = '$(lock) OmniSync: 미인증';
            statusBar.tooltip = '클릭하여 로그인';
            statusBar.command = 'universal-agent.login';
        }
    });

    vscode.window.showWarningMessage(
        'OmniSync Orchestrator을 사용하려면 로그인이 필요합니다.',
        '로그인',
    ).then((choice) => {
        if (choice === '로그인') {
            vscode.commands.executeCommand('universal-agent.login');
        }
    });
}

/**
 * 인증된 사용자를 위한 전체 기능 초기화.
 * Phase 4: GitDiffCollector, TerminalListener, ExportManager, PayloadBuilder를 DI하여
 * 오케스트레이터 파이프라인 초기화.
 */
function initializeFullFeatures(context: vscode.ExtensionContext): void {
    if (initialized) { return; }
    initialized = true;

    // 상태바에 인증 정보 표시
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.text = `$(verified) ${licenseManager?.planName ?? 'DEV'} Plan`;
    statusBar.tooltip = 'OmniSync Orchestrator - 인증됨';
    statusBar.show();
    context.subscriptions.push(statusBar);

    // ── 핵심 모듈 초기화 (이미 activate에서 생성된 것은 재사용) ──
    plannerView = new PlannerViewProvider();
    // memoryManager는 activate()에서 이미 생성됨
    tracker = new Tracker(memoryManager);

    // ── Phase 4: 오케스트레이터 파이프라인 초기화 (DI) ──
    gitDiffCollector = new GitDiffCollector();
    terminalListener = new TerminalListener();
    payloadBuilder = new PayloadBuilder();
    exportManager = new ExportManager();

    // TerminalListener는 추적 시작 시 활성화 (자원 절약)
    context.subscriptions.push({
        dispose: () => {
            terminalListener.dispose?.();
        },
    });

    // TreeView는 이미 activate()에서 초기화되었으므로, 연결 상태만 갱신
    connectionManager.checkConnection().catch((err) => {
        console.warn('[OmniSync] 트래커 연결 확인 실패 (설정 미입력?):', err.message);
    });

    let treeActionDisposables: vscode.Disposable[] = [];
    try {
        treeActionDisposables = registerTreeActions(treeProvider, connectionManager);
    } catch (err: any) {
        console.error('[OmniSync] TreeActions 등록 실패:', err.message);
    }

    // ── Fetch Issue (대시보드 Webview) ──
    const fetchIssueDisposable = vscode.commands.registerCommand(
        'universal-agent.fetchIssue',
        async (issueKeyArg?: string) => {
            const issueKey = issueKeyArg ?? await promptIssueKey();
            if (!issueKey) { return; }

            const config = await validateConfig();
            if (!config) { return; }

            await DashboardPanel.createOrShow(context, issueKey, config as any, memoryManager);
        }
    );

    // ── Generate Work Plan ──
    const generatePlanDisposable = vscode.commands.registerCommand(
        'universal-agent.generatePlan',
        async () => {
            const issueKey = await promptIssueKey();
            if (!issueKey) { return; }

            const config = await validateConfig();
            if (!config) { return; }

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `작업 계획서 생성 중: ${issueKey}`, cancellable: true },
                async (progress, token) => {
                    try {
                        progress.report({ message: '이슈 조회 중...' });
                        const adapter = createTrackerAdapter(config as any);
                        const issueData = await (adapter as JiraTrackerAdapter).fetchJiraIssue(issueKey);
                        if (token.isCancellationRequested) { return; }

                        progress.report({ message: 'AI가 계획서를 작성하고 있습니다...' });

                        if (!isDevMode() && !(await licenseManager.checkFeatureUsage('ai_plan'))) {
                            return;
                        }

                        const result = await generateWorkPlan(issueData as any, (config as any).llmApiKey, token);
                        if (token.isCancellationRequested) { return; }

                        plannerView.show(result.plan, issueKey);
                        vscode.window.showInformationMessage(`📋 ${issueKey} 작업 계획서 생성 완료 (${result.provider}: ${result.model})`);
                    } catch (err: any) {
                        if (!token.isCancellationRequested) {
                            vscode.window.showErrorMessage(`작업 계획서 생성 실패: ${err.message}`);
                        }
                    }
                }
            );
        }
    );

    // ── Start Tracking ──
    const startTrackingDisposable = vscode.commands.registerCommand(
        'universal-agent.startTracking',
        async () => {
            if (tracker.tracking) {
                vscode.window.showWarningMessage('이미 추적 중입니다.');
                return;
            }
            const issueKey = await promptIssueKey();
            if (!issueKey) { return; }

            await tracker.start(issueKey);
            terminalListener.startListening(); // Phase 4: 터미널 수집 시작
            vscode.window.showInformationMessage(`🔴 추적 시작: ${issueKey}`);
        }
    );

    // ── Stop Tracking ──
    const stopTrackingDisposable = vscode.commands.registerCommand(
        'universal-agent.stopTracking',
        async () => {
            if (!tracker.tracking) {
                vscode.window.showWarningMessage('추적 중이 아닙니다.');
                return;
            }
            const session = await memoryManager.endSession();
            tracker.stop();
            terminalListener.stopListening(); // Phase 4: 터미널 수집 중지

            if (session) {
                const stats = {
                    files: session.fileChanges.length,
                    terminal: session.terminalEntries.length,
                    chats: session.chatEntries.length,
                };
                vscode.window.showInformationMessage(
                    `⏹ 추적 종료: ${session.issueKey} | 파일: ${stats.files} | 터미널: ${stats.terminal} | 대화: ${stats.chats}`
                );
            }
        }
    );

    // ── Toggle Tracking ──
    const toggleTrackingDisposable = vscode.commands.registerCommand(
        'universal-agent.toggleTracking',
        async () => {
            if (tracker.tracking) {
                await vscode.commands.executeCommand('universal-agent.stopTracking');
            } else {
                await vscode.commands.executeCommand('universal-agent.startTracking');
            }
        }
    );

    // ── Chat Participant (@agent) 등록 ──
    const chatParticipantDisposable = registerChatParticipant(memoryManager);

    // ── Finish Work & Report (Phase 5: React Webview 패널로 전환) ──
    const finishAndReportDisposable = vscode.commands.registerCommand(
        'universal-agent.finishAndReport',
        async () => {
            const session = memoryManager.getSession();
            if (!session) {
                vscode.window.showWarningMessage('활성 추적 세션이 없습니다. 먼저 Start Tracking을 실행하세요.');
                return;
            }

            const config = await validateConfig();
            if (!config) { return; }

            if (tracker.tracking) { tracker.stop(); }
            await memoryManager.endSession();

            // Webview 액션 핸들러 — ReportPanel에서 이벤트를 수신하여 처리
            const handleReportAction = async (msg: WebviewToExtMessage): Promise<void> => {
                const adapter = createTrackerAdapter(config as any);
                switch (msg.type) {
                    case 'action:sendToTracker':
                        await exportManager.exportToTracker(adapter, msg.payload.issueKey, msg.payload.markdown);
                        // Jira 전용: 상태 전환 제안
                        if (adapter instanceof JiraTrackerAdapter) {
                            try {
                                const transitions = await adapter.getTransitions(msg.payload.issueKey);
                                if (transitions.length > 0) {
                                    const selected = await vscode.window.showQuickPick(
                                        transitions.map(t => ({ label: t.name, id: t.id })),
                                        { placeHolder: '이슈 상태를 변경하시겠습니까? (ESC로 건너뛰기)' }
                                    );
                                    if (selected) {
                                        await adapter.updateIssue(msg.payload.issueKey, '', selected.label);
                                        vscode.window.showInformationMessage(`🔄 ${msg.payload.issueKey} 상태 → ${selected.label}`);
                                    }
                                }
                            } catch { /* 상태 전환 실패 무시 */ }
                        }
                        treeProvider.refresh();
                        break;

                    case 'action:saveLocal':
                        await exportManager.exportToLocalFile(msg.payload.issueKey, msg.payload.markdown);
                        break;

                    case 'action:copyClipboard':
                        await exportManager.exportToClipboard(msg.payload.markdown);
                        break;

                    case 'action:regenerate': {
                        // AI 재작성 요청
                        const reportPanel = ReportPanel.createOrShow(context.extensionUri, handleReportAction);
                        reportPanel.sendStatus('loading', 'AI가 리포트를 재작성하고 있습니다...');
                        try {
                            const regeneratedResult = await generateReport(session, (config as any).llmApiKey, new vscode.CancellationTokenSource().token);
                            reportPanel.sendReport({
                                markdown: regeneratedResult.report,
                                issueKey: session.issueKey,
                                metadata: {
                                    platform: (config as any).platform,
                                    generatedAt: new Date().toISOString(),
                                    provider: regeneratedResult.provider,
                                    model: regeneratedResult.model,
                                },
                            });
                        } catch (err: any) {
                            reportPanel.sendStatus('error', `재작성 실패: ${err.message}`);
                        }
                        break;
                    }

                    case 'action:editReport':
                        // Webview 내부에서 처리 — Extension Host는 최신 마크다운만 캐시
                        break;
                }
            };

            // ReportPanel 열기
            const reportPanel = ReportPanel.createOrShow(context.extensionUri, handleReportAction);
            reportPanel.sendStatus('loading', '리포트를 생성하고 있습니다...');

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `리포트 생성 중: ${session.issueKey}`, cancellable: true },
                async (progress, token) => {
                    try {
                        let reportText: string;
                        let provider: string | undefined;
                        let model: string | undefined;
                        const hasData = session.terminalEntries.length > 0 || session.fileChanges.length > 0;

                        if (hasData) {
                            if (!isDevMode() && !(await licenseManager.checkFeatureUsage('auto_report'))) {
                                reportText = generateSimpleReport(session);
                            } else {
                                progress.report({ message: 'AI가 작업 리포트를 작성하고 있습니다...' });
                                try {
                                    const result = await generateReport(session, (config as any).llmApiKey, token);
                                    reportText = result.report;
                                    provider = result.provider;
                                    model = result.model;
                                } catch {
                                    reportText = generateSimpleReport(session);
                                }
                            }
                        } else {
                            reportText = generateSimpleReport(session);
                        }

                        if (token.isCancellationRequested) { return; }

                        // Phase 4: 오케스트레이터를 통한 페이로드 빌드
                        const gitDiff = await gitDiffCollector.collect().catch(() => '');
                        const terminalLog = terminalListener.getLog();
                        payloadBuilder.build({
                            issueId: session.issueKey,
                            report: reportText,
                            gitDiff,
                            terminalLog,
                            fileChanges: session.fileChanges,
                        });

                        // Phase 5: React Webview 패널에 리포트 전달
                        reportPanel.sendReport({
                            markdown: reportText,
                            issueKey: session.issueKey,
                            metadata: {
                                platform: (config as any).platform,
                                generatedAt: new Date().toISOString(),
                                provider,
                                model,
                            },
                        });

                        await memoryManager.clearSession();
                    } catch (err: any) {
                        if (!token.isCancellationRequested) {
                            reportPanel.sendStatus('error', `리포트 생성 실패: ${err.message}`);
                            vscode.window.showErrorMessage(`리포트 생성 실패: ${err.message}`);
                        }
                    }
                }
            );
        }
    );

    context.subscriptions.push(
        fetchIssueDisposable,
        generatePlanDisposable,
        startTrackingDisposable,
        stopTrackingDisposable,
        toggleTrackingDisposable,
        chatParticipantDisposable,
        finishAndReportDisposable,
        tracker,
        // treeView, connectionManager는 activate()에서 이미 등록됨
        ...treeActionDisposables,
    );
}

// ─── 공통 헬퍼 ───

async function promptIssueKey(): Promise<string | undefined> {
    const input = await vscode.window.showInputBox({
        prompt: '이슈 키를 입력하세요',
        placeHolder: 'PROJ-123',
        validateInput: (value) => {
            if (!/^[A-Z][A-Z0-9_]+-\d+$/i.test(value.trim())) {
                return '올바른 이슈 키 형식이 아닙니다 (예: PROJ-123)';
            }
            return null;
        },
    });
    return input?.trim().toUpperCase();
}

async function validateConfig() {
    try {
        return getTrackerConfig();
    } catch (err: any) {
        const openSettings = '설정 열기';
        const selection = await vscode.window.showErrorMessage(err.message, openSettings);
        if (selection === openSettings) {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'universalAgent');
        }
        return null;
    }
}

/**
 * TrackerConfig에 따라 적절한 TrackerAdapter 구현체를 반환한다.
 * 현재는 Jira만 지원하며, GitHub/Linear는 추후 구현한다.
 */
function createTrackerAdapter(config: import('./config').TrackerConfig) {
    switch (config.platform) {
        case 'jira-cloud':
        case 'jira-server':
            return new JiraTrackerAdapter(config);
        default:
            // TODO: GitHubTrackerAdapter, LinearTrackerAdapter 구현 후 추가
            console.warn(`[OmniSync] 아직 지원하지 않는 플랫폼: ${config.platform}. Jira로 폴백.`);
            return new JiraTrackerAdapter(config);
    }
}

/**
 * VS Code에 활성화된 AI 서비스를 활용하여 이슈를 요약한다.
 * issueDashboard.ts 등 외부 모듈에서 재사용 가능하도록 export.
 */
export async function summarizeWithActiveAI(
    issue: import('./adapters/JiraTrackerAdapter').JiraIssueData,
    apiKey: string
): Promise<void> {
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `AI 요약 중: ${issue.key}`, cancellable: true },
        async (_progress, token) => {
            try {
                if (!isDevMode() && !(await licenseManager.checkFeatureUsage('ai_summary'))) {
                    return;
                }

                const issueContext = `# ${issue.key}: ${issue.summary}\n\n상태: ${issue.status}\n\n설명:\n${issue.description ?? '_없음_'}`;
                const result = await sendLlmRequest(
                    [
                        {
                            role: 'system',
                            content: `당신은 시니어 개발자입니다. 이슈를 한국어로 간결하게 요약해 주세요.
다음을 포함하세요:
1. 핵심 요약 (2-3줄)
2. 작업 시작 전 주의할 점
3. 예상 난이도 (상/중/하)`,
                        },
                        { role: 'user', content: issueContext },
                    ],
                    apiKey,
                    token
                );

                if (token.isCancellationRequested) { return; }

                const header = `# 🤖 AI 요약: ${issue.key}\n> by **${result.model}** (${result.provider})\n\n---\n\n`;
                const doc = await vscode.workspace.openTextDocument({ content: header + result.text, language: 'markdown' });
                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });

                vscode.window.showInformationMessage(`🤖 ${issue.key} AI 요약 완료 (${result.provider})`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`AI 요약 실패: ${err.message}`);
            }
        }
    );
}

export function deactivate() {}
