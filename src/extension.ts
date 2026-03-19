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
import { GitTrigger } from './trigger/GitTrigger';
import { ChangeClassifier } from './analyzer/ChangeClassifier';
import { logger } from './utils/logger';

// ??? ?깃????몄뒪?댁뒪 ???
let plannerView: PlannerViewProvider;
let memoryManager: MemoryManager;
let tracker: Tracker;
let connectionManager: ConnectionManager;
let treeProvider: JiraTreeDataProvider;
let licenseManager: LicenseManager;
// Phase 4: ?ㅼ??ㅽ듃?덉씠???뚯씠?꾨씪??紐⑤뱢
let gitDiffCollector: GitDiffCollector;
let terminalListener: TerminalListener;
let exportManager: ExportManager;
let payloadBuilder: PayloadBuilder;
let gitTrigger: GitTrigger;
let changeClassifier: ChangeClassifier;
let initialized = false;

export async function activate(context: vscode.ExtensionContext) {
    logger.init();
    console.log('[Orx Orchestrator] 익스텐션이 활성화되었습니다.');
    logger.info('Orx Orchestrator 활성화');

    // ?? TreeView ?ъ씠?쒕컮 珥덇린??(??긽 ?쒖떆, ?몄쬆 ?щ?? 臾닿?) ??
    connectionManager = new ConnectionManager();
    memoryManager = new MemoryManager(context.workspaceState);
    treeProvider = new JiraTreeDataProvider(connectionManager, memoryManager);

    const treeView = vscode.window.createTreeView('orx.issueExplorer', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView, connectionManager);

    // ?? 誘몄씤利??곹깭?먯꽌???숈옉?댁빞 ?섎뒗 而ㅻ㎤?쒕? ?ш린???깅줉 ??
    context.subscriptions.push(
        vscode.commands.registerCommand('orx.refreshTree', () => {
            connectionManager.checkConnection();
            treeProvider.refresh();
        }),
        vscode.commands.registerCommand('orx.searchIssues', () => {
            vscode.commands.executeCommand('orx.searchJql');
        }),
    );

    // ?뚮옯???좏깮 + 濡쒓렇???⑤꼸
    const openWelcome = () => {
        WelcomePanel.createOrShow(context, () => {
            connectionManager.checkConnection().then(() => treeProvider.refresh());
        });
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('orx.selectPlatform', openWelcome),
    );

    // ?곌껐 ?곹깭 ?뺤씤 (?ㅽ뙣?대룄 臾댁떆 ???ㅼ젙 誘몄엯????
    connectionManager.checkConnection().catch((err) => {
        logger.warn(`초기 연결 확인 실패 (설정 미입력 가능): ${err instanceof Error ? err.message : String(err)}`);
    });

    // ?? [DEV MODE] 媛쒕컻 紐⑤뱶 諛붿씠?⑥뒪 ??
    if (isDevMode()) {
        console.log('?좑툘 [DEV MODE] ?쇱씠?좎뒪 寃利?嫄대꼫? ??紐⑤뱺 湲곕뒫 ?쒖꽦??);

        // DEV MODE?먯꽌??login ??WelcomePanel
        context.subscriptions.push(
            vscode.commands.registerCommand('orx.login', openWelcome),
            vscode.commands.registerCommand('orx.logout', () => {
                vscode.window.showInformationMessage('DEV MODE?먯꽌??濡쒓렇?꾩썐???꾩슂 ?놁뒿?덈떎.');
            }),
        );

        initializeFullFeatures(context);

        const devStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        devStatusBar.text = '$(beaker) DEV MODE';
        devStatusBar.tooltip = 'Orx Orchestrator ??媛쒕컻 紐⑤뱶 (?쇱씠?좎뒪 寃利?嫄대꼫?)';
        devStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        devStatusBar.show();
        context.subscriptions.push(devStatusBar);
        return;
    }

    // ?? [LICENSE GATE] ?쇱씠?좎뒪 寃利?寃뚯씠??(?꾨줈?뺤뀡) ??
    const licenseClient = new LicenseClient(getLicenseServerUrl());
    const machineId = vscode.env.machineId;
    licenseManager = new LicenseManager(
        context.secrets,
        licenseClient,
        machineId,
        context.extension.packageJSON.version ?? '0.0.0',
    );

    await licenseManager.initialize();

    // ?? 濡쒓렇??濡쒓렇?꾩썐 而ㅻ㎤???깅줉 (?몄쬆 ?곹깭? 臾닿??섍쾶 ??긽 ?깅줉) ??
    context.subscriptions.push(
        vscode.commands.registerCommand('orx.login', async () => {
            const platform = getPlatform();

            if (platform === 'jira-cloud') {
                // Cloud OAuth 2.0 ?먮쫫
                const oauthManager = new OAuthManager(context.secrets);
                const success = await oauthManager.login();
                if (success) {
                    vscode.window.showInformationMessage(
                        'Jira Cloud???곌껐?섏뿀?듬땲?? VS Code瑜??ъ떆?묓븯嫄곕굹 李쎌쓣 ?덈줈怨좎묠?섎㈃ ?꾩쟾???쒖꽦?붾맗?덈떎.',
                    );
                    connectionManager.checkConnection();
                }
            } else {
                // Server/DC/GitHub/Linear: LicenseManager 湲곕컲 ?몄쬆
                const success = await licenseManager.login();
                if (success) {
                    initializeFullFeatures(context);
                    connectionManager.checkConnection();
                }
            }
        }),
        vscode.commands.registerCommand('orx.logout', async () => {
            await licenseManager.logout();
            vscode.window.showInformationMessage(
                '湲곕뒫??鍮꾪솢?깊솕?섏뿀?듬땲?? ?ㅼ떆 ?ъ슜?섎젮硫?VS Code瑜??ъ떆?묓빐 二쇱꽭??',
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
 * 鍮꾩씤利??곹깭 UI: ?곹깭諛붿뿉 誘몄씤利??쒖떆 + 濡쒓렇???좊룄 硫붿떆吏
 */
function showUnauthenticatedUI(context: vscode.ExtensionContext): void {
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.text = '$(lock) Orx: 誘몄씤利?;
    statusBar.tooltip = '?대┃?섏뿬 濡쒓렇??;
    statusBar.command = 'orx.login';
    statusBar.show();
    context.subscriptions.push(statusBar);

    licenseManager.onDidChangeAuth((status) => {
        if (status === 'authenticated') {
            statusBar.text = `$(verified) ${licenseManager.planName} Plan`;
            statusBar.tooltip = 'Orx Orchestrator - ?몄쬆??;
            statusBar.command = undefined;
        } else if (status === 'checking') {
            statusBar.text = '$(sync~spin) Orx: ?뺤씤 以?..';
        } else {
            statusBar.text = '$(lock) Orx: 誘몄씤利?;
            statusBar.tooltip = '?대┃?섏뿬 濡쒓렇??;
            statusBar.command = 'orx.login';
        }
    });

    vscode.window.showWarningMessage(
        'Orx Orchestrator???ъ슜?섎젮硫?濡쒓렇?몄씠 ?꾩슂?⑸땲??',
        '濡쒓렇??,
    ).then((choice) => {
        if (choice === '濡쒓렇??) {
            vscode.commands.executeCommand('orx.login');
        }
    });
}

/**
 * ?몄쬆???ъ슜?먮? ?꾪븳 ?꾩껜 湲곕뒫 珥덇린??
 * Phase 4: GitDiffCollector, TerminalListener, ExportManager, PayloadBuilder瑜?DI?섏뿬
 * ?ㅼ??ㅽ듃?덉씠???뚯씠?꾨씪??珥덇린??
 */
function initializeFullFeatures(context: vscode.ExtensionContext): void {
    if (initialized) { return; }
    initialized = true;

    // ?곹깭諛붿뿉 ?몄쬆 ?뺣낫 ?쒖떆
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.text = `$(verified) ${licenseManager?.planName ?? 'DEV'} Plan`;
    statusBar.tooltip = 'Orx Orchestrator - ?몄쬆??;
    statusBar.show();
    context.subscriptions.push(statusBar);

    // ?? ?듭떖 紐⑤뱢 珥덇린??(?대? activate?먯꽌 ?앹꽦??寃껋? ?ъ궗?? ??
    plannerView = new PlannerViewProvider();
    // memoryManager??activate()?먯꽌 ?대? ?앹꽦??
    tracker = new Tracker(memoryManager);

    // ?? Phase 4: ?ㅼ??ㅽ듃?덉씠???뚯씠?꾨씪??珥덇린??(DI) ??
    gitDiffCollector = new GitDiffCollector();
    terminalListener = new TerminalListener();
    payloadBuilder = new PayloadBuilder();
    exportManager = new ExportManager();

    // ── Phase 5: Work Session 확장 모듈 ──
    changeClassifier = new ChangeClassifier();
    gitTrigger = new GitTrigger(memoryManager);
    gitTrigger.register();
    context.subscriptions.push(gitTrigger);

    // TerminalListener??異붿쟻 ?쒖옉 ???쒖꽦??(?먯썝 ?덉빟)
    context.subscriptions.push({
        dispose: () => {
            terminalListener.dispose?.();
        },
    });

    // TreeView???대? activate()?먯꽌 珥덇린?붾릺?덉쑝誘濡? ?곌껐 ?곹깭留?媛깆떊
    connectionManager.checkConnection().catch((err) => {
        logger.warn(`트래커 연결 확인 실패: ${err instanceof Error ? err.message : String(err)}`);
    });

    let treeActionDisposables: vscode.Disposable[] = [];
    try {
        treeActionDisposables = registerTreeActions(treeProvider, connectionManager);
    } catch (err: any) {
        console.error('[Orx] TreeActions ?깅줉 ?ㅽ뙣:', err.message);
    }

    // ?? Fetch Issue (??쒕낫??Webview) ??
    const fetchIssueDisposable = vscode.commands.registerCommand(
        'orx.fetchIssue',
        async (issueKeyArg?: string) => {
            const issueKey = issueKeyArg ?? await promptIssueKey();
            if (!issueKey) { return; }

            const config = await validateConfig();
            if (!config) { return; }

            await DashboardPanel.createOrShow(context, issueKey, config as any, memoryManager);
        }
    );

    // ?? Generate Work Plan ??
    const generatePlanDisposable = vscode.commands.registerCommand(
        'orx.generatePlan',
        async () => {
            const issueKey = await promptIssueKey();
            if (!issueKey) { return; }

            const config = await validateConfig();
            if (!config) { return; }

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `?묒뾽 怨꾪쉷???앹꽦 以? ${issueKey}`, cancellable: true },
                async (progress, token) => {
                    try {
                        progress.report({ message: '?댁뒋 議고쉶 以?..' });
                        const adapter = createTrackerAdapter(config as any);
                        const issueData = await (adapter as JiraTrackerAdapter).fetchJiraIssue(issueKey);
                        if (token.isCancellationRequested) { return; }

                        progress.report({ message: 'AI媛 怨꾪쉷?쒕? ?묒꽦?섍퀬 ?덉뒿?덈떎...' });

                        if (!isDevMode() && !(await licenseManager.checkFeatureUsage('ai_plan'))) {
                            return;
                        }

                        const result = await generateWorkPlan(issueData as any, (config as any).llmApiKey, token);
                        if (token.isCancellationRequested) { return; }

                        plannerView.show(result.plan, issueKey);
                        vscode.window.showInformationMessage(`?뱥 ${issueKey} ?묒뾽 怨꾪쉷???앹꽦 ?꾨즺 (${result.provider}: ${result.model})`);
                    } catch (err: any) {
                        if (!token.isCancellationRequested) {
                            vscode.window.showErrorMessage(`?묒뾽 怨꾪쉷???앹꽦 ?ㅽ뙣: ${err.message}`);
                        }
                    }
                }
            );
        }
    );

    // ?? Start Tracking ??
    const startTrackingDisposable = vscode.commands.registerCommand(
        'orx.startTracking',
        async () => {
            if (tracker.tracking) {
                vscode.window.showWarningMessage('?대? 異붿쟻 以묒엯?덈떎.');
                return;
            }
            const issueKey = await promptIssueKey();
            if (!issueKey) { return; }

            await tracker.start(issueKey);
            terminalListener.startListening(); // Phase 4: ?곕????섏쭛 ?쒖옉
            vscode.window.showInformationMessage(`?뵶 異붿쟻 ?쒖옉: ${issueKey}`);
        }
    );

    // ?? Stop Tracking ??
    const stopTrackingDisposable = vscode.commands.registerCommand(
        'orx.stopTracking',
        async () => {
            if (!tracker.tracking) {
                vscode.window.showWarningMessage('異붿쟻 以묒씠 ?꾨떃?덈떎.');
                return;
            }
            const session = await memoryManager.endSession();
            tracker.stop();
            terminalListener.stopListening(); // Phase 4: ?곕????섏쭛 以묒?

            if (session) {
                const stats = {
                    files: session.fileChanges.length,
                    terminal: session.terminalEntries.length,
                    chats: session.chatEntries.length,
                };
                vscode.window.showInformationMessage(
                    `??異붿쟻 醫낅즺: ${session.issueKey} | ?뚯씪: ${stats.files} | ?곕??? ${stats.terminal} | ??? ${stats.chats}`
                );
            }
        }
    );

    // ?? Toggle Tracking ??
    const toggleTrackingDisposable = vscode.commands.registerCommand(
        'orx.toggleTracking',
        async () => {
            if (tracker.tracking) {
                await vscode.commands.executeCommand('orx.stopTracking');
            } else {
                await vscode.commands.executeCommand('orx.startTracking');
            }
        }
    );

    // ?? Chat Participant (@agent) ?깅줉 ??
    const chatParticipantDisposable = registerChatParticipant(memoryManager);

    // ?? Finish Work & Report (Phase 5: React Webview ?⑤꼸濡??꾪솚) ??
    const finishAndReportDisposable = vscode.commands.registerCommand(
        'orx.finishAndReport',
        async () => {
            const session = memoryManager.getSession();
            if (!session) {
                vscode.window.showWarningMessage('?쒖꽦 異붿쟻 ?몄뀡???놁뒿?덈떎. 癒쇱? Start Tracking???ㅽ뻾?섏꽭??');
                return;
            }

            const config = await validateConfig();
            if (!config) { return; }

            if (tracker.tracking) { tracker.stop(); }
            await memoryManager.endSession();

            // Webview ?≪뀡 ?몃뱾????ReportPanel?먯꽌 ?대깽?몃? ?섏떊?섏뿬 泥섎━
            const handleReportAction = async (msg: WebviewToExtMessage): Promise<void> => {
                const adapter = createTrackerAdapter(config as any);
                switch (msg.type) {
                    case 'action:sendToTracker':
                        await exportManager.exportToTracker(adapter, msg.payload.issueKey, msg.payload.markdown);
                        // Jira ?꾩슜: ?곹깭 ?꾪솚 ?쒖븞
                        if (adapter instanceof JiraTrackerAdapter) {
                            try {
                                const transitions = await adapter.getTransitions(msg.payload.issueKey);
                                if (transitions.length > 0) {
                                    const selected = await vscode.window.showQuickPick(
                                        transitions.map(t => ({ label: t.name, id: t.id })),
                                        { placeHolder: '?댁뒋 ?곹깭瑜?蹂寃쏀븯?쒓쿋?듬땲源? (ESC濡?嫄대꼫?곌린)' }
                                    );
                                    if (selected) {
                                        await adapter.updateIssue(msg.payload.issueKey, '', selected.label);
                                        vscode.window.showInformationMessage(`?봽 ${msg.payload.issueKey} ?곹깭 ??${selected.label}`);
                                    }
                                }
                            } catch { /* ?곹깭 ?꾪솚 ?ㅽ뙣 臾댁떆 */ }
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
                        // AI ?ъ옉???붿껌
                        const reportPanel = ReportPanel.createOrShow(context.extensionUri, handleReportAction);
                        reportPanel.sendStatus('loading', 'AI媛 由ы룷?몃? ?ъ옉?깊븯怨??덉뒿?덈떎...');
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
                            reportPanel.sendStatus('error', `?ъ옉???ㅽ뙣: ${err.message}`);
                        }
                        break;
                    }

                    case 'action:editReport':
                        // Webview ?대??먯꽌 泥섎━ ??Extension Host??理쒖떊 留덊겕?ㅼ슫留?罹먯떆
                        break;
                }
            };

            // ReportPanel ?닿린
            const reportPanel = ReportPanel.createOrShow(context.extensionUri, handleReportAction);
            reportPanel.sendStatus('loading', '由ы룷?몃? ?앹꽦?섍퀬 ?덉뒿?덈떎...');

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `由ы룷???앹꽦 以? ${session.issueKey}`, cancellable: true },
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
                                progress.report({ message: 'AI媛 ?묒뾽 由ы룷?몃? ?묒꽦?섍퀬 ?덉뒿?덈떎...' });
                                try {
                                    const result = await generateReport(session, (config as any).llmApiKey, token);
                                    reportText = result.report;
                                    provider = result.provider;
                                    model = result.model;
                                } catch (llmErr) {
                                    logger.error('LLM 리포트 생성 실패, 간단 리포트로 대체', llmErr);
                                    reportText = generateSimpleReport(session);
                                }
                            }
                        } else {
                            reportText = generateSimpleReport(session);
                        }

                        if (token.isCancellationRequested) { return; }

                        // Phase 4: ?ㅼ??ㅽ듃?덉씠?곕? ?듯븳 ?섏씠濡쒕뱶 鍮뚮뱶
                        const gitDiff = await gitDiffCollector.collect().catch((err) => {
                            logger.warn(`Git diff 수집 실패: ${err instanceof Error ? err.message : String(err)}`);
                            return '';
                        });
                        const terminalLog = terminalListener.getLog();
                        payloadBuilder.build({
                            issueId: session.issueKey,
                            report: reportText,
                            gitDiff,
                            terminalLog,
                            fileChanges: session.fileChanges,
                        });

                        // Phase 5: React Webview ?⑤꼸??由ы룷???꾨떖
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
                            reportPanel.sendStatus('error', `由ы룷???앹꽦 ?ㅽ뙣: ${err.message}`);
                            vscode.window.showErrorMessage(`由ы룷???앹꽦 ?ㅽ뙣: ${err.message}`);
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
        // treeView, connectionManager??activate()?먯꽌 ?대? ?깅줉??
        ...treeActionDisposables,
    );
}

// ??? 怨듯넻 ?ы띁 ???

async function promptIssueKey(): Promise<string | undefined> {
    const input = await vscode.window.showInputBox({
        prompt: '?댁뒋 ?ㅻ? ?낅젰?섏꽭??,
        placeHolder: 'PROJ-123',
        validateInput: (value) => {
            if (!/^[A-Z][A-Z0-9_]+-\d+$/i.test(value.trim())) {
                return '?щ컮瑜??댁뒋 ???뺤떇???꾨떃?덈떎 (?? PROJ-123)';
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
        const openSettings = '?ㅼ젙 ?닿린';
        const selection = await vscode.window.showErrorMessage(err.message, openSettings);
        if (selection === openSettings) {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'orx');
        }
        return null;
    }
}

/**
 * TrackerConfig???곕씪 ?곸젅??TrackerAdapter 援ы쁽泥대? 諛섑솚?쒕떎.
 * ?꾩옱??Jira留?吏?먰븯硫? GitHub/Linear??異뷀썑 援ы쁽?쒕떎.
 */
function createTrackerAdapter(config: import('./config').TrackerConfig) {
    switch (config.platform) {
        case 'jira-cloud':
        case 'jira-server':
            return new JiraTrackerAdapter(config);
        default:
            // TODO: GitHubTrackerAdapter, LinearTrackerAdapter 援ы쁽 ??異붽?
            console.warn(`[Orx] ?꾩쭅 吏?먰븯吏 ?딅뒗 ?뚮옯?? ${config.platform}. Jira濡??대갚.`);
            return new JiraTrackerAdapter(config);
    }
}

/**
 * VS Code???쒖꽦?붾맂 AI ?쒕퉬?ㅻ? ?쒖슜?섏뿬 ?댁뒋瑜??붿빟?쒕떎.
 * issueDashboard.ts ???몃? 紐⑤뱢?먯꽌 ?ъ궗??媛?ν븯?꾨줉 export.
 */
export async function summarizeWithActiveAI(
    issue: import('./adapters/JiraTrackerAdapter').JiraIssueData,
    apiKey: string
): Promise<void> {
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `AI ?붿빟 以? ${issue.key}`, cancellable: true },
        async (_progress, token) => {
            try {
                if (!isDevMode() && !(await licenseManager.checkFeatureUsage('ai_summary'))) {
                    return;
                }

                const issueContext = `# ${issue.key}: ${issue.summary}\n\n?곹깭: ${issue.status}\n\n?ㅻ챸:\n${issue.description ?? '_?놁쓬_'}`;
                const result = await sendLlmRequest(
                    [
                        {
                            role: 'system',
                            content: `?뱀떊? ?쒕땲??媛쒕컻?먯엯?덈떎. ?댁뒋瑜??쒓뎅?대줈 媛꾧껐?섍쾶 ?붿빟??二쇱꽭??
?ㅼ쓬???ы븿?섏꽭??
1. ?듭떖 ?붿빟 (2-3以?
2. ?묒뾽 ?쒖옉 ??二쇱쓽????
3. ?덉긽 ?쒖씠??(??以???`,
                        },
                        { role: 'user', content: issueContext },
                    ],
                    apiKey,
                    token
                );

                if (token.isCancellationRequested) { return; }

                const header = `# ?쨼 AI ?붿빟: ${issue.key}\n> by **${result.model}** (${result.provider})\n\n---\n\n`;
                const doc = await vscode.workspace.openTextDocument({ content: header + result.text, language: 'markdown' });
                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });

                vscode.window.showInformationMessage(`?쨼 ${issue.key} AI ?붿빟 ?꾨즺 (${result.provider})`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`AI ?붿빟 ?ㅽ뙣: ${err.message}`);
            }
        }
    );
}

export function deactivate() {}
