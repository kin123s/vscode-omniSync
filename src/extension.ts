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

// ── Global singleton instances ──
let plannerView: PlannerViewProvider;
let memoryManager: MemoryManager;
let tracker: Tracker;
let connectionManager: ConnectionManager;
let treeProvider: JiraTreeDataProvider;
let licenseManager: LicenseManager;
// Phase 4: Dashboard pipeline data models
let gitDiffCollector: GitDiffCollector;
let terminalListener: TerminalListener;
let exportManager: ExportManager;
let payloadBuilder: PayloadBuilder;
let gitTrigger: GitTrigger;
let changeClassifier: ChangeClassifier;
let initialized = false;

export async function activate(context: vscode.ExtensionContext) {
    logger.init();
    console.log('[Orx Orchestrator] Extension activated.');
    logger.info('Orx Orchestrator activated');

    // ── TreeView sidebar init (always visible, regardless of auth) ──
    connectionManager = new ConnectionManager();
    memoryManager = new MemoryManager(context.workspaceState);
    treeProvider = new JiraTreeDataProvider(connectionManager, memoryManager);

    const treeView = vscode.window.createTreeView('orx.issueExplorer', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView, connectionManager);

    // ── Commands that work regardless of auth ──
    context.subscriptions.push(
        vscode.commands.registerCommand('orx.refreshTree', () => {
            connectionManager.checkConnection();
            treeProvider.refresh();
        }),
        vscode.commands.registerCommand('orx.searchIssues', () => {
            vscode.commands.executeCommand('orx.searchJql');
        }),
    );

    // ── Platform selection + login link ──
    const openWelcome = () => {
        WelcomePanel.createOrShow(context, () => {
            connectionManager.checkConnection().then(() => treeProvider.refresh());
        });
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('orx.selectPlatform', openWelcome),
    );

    // Initial connection check (failures ignored — settings may be incomplete)
    connectionManager.checkConnection().catch((err) => {
        logger.warn(`Initial connection check failed (settings may be missing): ${err instanceof Error ? err.message : String(err)}`);
    });

    // ── [DEV MODE] Bypass license checks ──
    if (isDevMode()) {
        console.log('[DEV MODE] License bypass enabled — all features active');

        // DEV MODE: login → WelcomePanel
        context.subscriptions.push(
            vscode.commands.registerCommand('orx.login', openWelcome),
            vscode.commands.registerCommand('orx.logout', () => {
                vscode.window.showInformationMessage('Logout is not required in DEV MODE.');
            }),
        );

        initializeFullFeatures(context);

        const devStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        devStatusBar.text = '$(beaker) DEV MODE';
        devStatusBar.tooltip = 'Orx Orchestrator — Development Mode (license bypass)';
        devStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        devStatusBar.show();
        context.subscriptions.push(devStatusBar);
        return;
    }

    // ── [LICENSE GATE] Production license check ──
    const licenseClient = new LicenseClient(getLicenseServerUrl());
    const machineId = vscode.env.machineId;
    licenseManager = new LicenseManager(
        context.secrets,
        licenseClient,
        machineId,
        context.extension.packageJSON.version ?? '0.0.0',
    );

    await licenseManager.initialize();

    // ── Login / Logout commands (registered regardless of auth) ──
    context.subscriptions.push(
        vscode.commands.registerCommand('orx.login', async () => {
            const platform = getPlatform();

            if (platform === 'jira-cloud') {
                // Cloud OAuth 2.0 flow
                const oauthManager = new OAuthManager(context.secrets);
                const success = await oauthManager.login();
                if (success) {
                    vscode.window.showInformationMessage(
                        'Connected to Jira Cloud. Please restart VS Code or reload the window for full activation.',
                    );
                    connectionManager.checkConnection();
                }
            } else {
                // Server/DC/GitHub/Linear: LicenseManager-based auth
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
                'Features deactivated. Please restart VS Code to re-authenticate.',
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
 * Unauthenticated state UI: shows status bar prompt + login message.
 */
function showUnauthenticatedUI(context: vscode.ExtensionContext): void {
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.text = '$(lock) Orx: Not Authenticated';
    statusBar.tooltip = 'Click to sign in';
    statusBar.command = 'orx.login';
    statusBar.show();
    context.subscriptions.push(statusBar);

    licenseManager.onDidChangeAuth((status) => {
        if (status === 'authenticated') {
            statusBar.text = `$(verified) ${licenseManager.planName} Plan`;
            statusBar.tooltip = 'Orx Orchestrator — Authenticated';
            statusBar.command = undefined;
        } else if (status === 'checking') {
            statusBar.text = '$(sync~spin) Orx: Checking...';
        } else {
            statusBar.text = '$(lock) Orx: Not Authenticated';
            statusBar.tooltip = 'Click to sign in';
            statusBar.command = 'orx.login';
        }
    });

    vscode.window.showWarningMessage(
        'Login is required to use Orx Orchestrator.',
        'Login',
    ).then((choice) => {
        if (choice === 'Login') {
            vscode.commands.executeCommand('orx.login');
        }
    });
}

/**
 * Initializes all features after authentication.
 * Phase 4: GitDiffCollector, TerminalListener, ExportManager, PayloadBuilder DI.
 * Phase 5: ChangeClassifier, GitTrigger initialization.
 */
function initializeFullFeatures(context: vscode.ExtensionContext): void {
    if (initialized) { return; }
    initialized = true;

    // Status bar: show auth info
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.text = `$(verified) ${licenseManager?.planName ?? 'DEV'} Plan`;
    statusBar.tooltip = 'Orx Orchestrator — Authenticated';
    statusBar.show();
    context.subscriptions.push(statusBar);

    // ── Core modules init (reuse instances created in activate) ──
    plannerView = new PlannerViewProvider();
    // memoryManager is already created in activate()
    tracker = new Tracker(memoryManager);

    // ── Phase 4: Dashboard pipeline init (DI) ──
    gitDiffCollector = new GitDiffCollector();
    terminalListener = new TerminalListener();
    payloadBuilder = new PayloadBuilder();
    exportManager = new ExportManager();

    // ── Phase 5: Work Session extension modules ──
    changeClassifier = new ChangeClassifier();
    gitTrigger = new GitTrigger(memoryManager);
    gitTrigger.register();
    context.subscriptions.push(gitTrigger);

    // TerminalListener disposal (resource cleanup)
    context.subscriptions.push({
        dispose: () => {
            terminalListener.dispose?.();
        },
    });

    // TreeView already initialized in activate(), just refresh connection
    connectionManager.checkConnection().catch((err) => {
        logger.warn(`Tracker connection check failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    let treeActionDisposables: vscode.Disposable[] = [];
    try {
        treeActionDisposables = registerTreeActions(treeProvider, connectionManager);
    } catch (err: any) {
        console.error('[Orx] TreeActions registration failed:', err.message);
    }

    // ── Fetch Issue (Dashboard Webview) ──
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

    // ── Generate Work Plan ──
    const generatePlanDisposable = vscode.commands.registerCommand(
        'orx.generatePlan',
        async () => {
            const issueKey = await promptIssueKey();
            if (!issueKey) { return; }

            const config = await validateConfig();
            if (!config) { return; }

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Generating work plan: ${issueKey}`, cancellable: true },
                async (progress, token) => {
                    try {
                        progress.report({ message: 'Fetching issue...' });
                        const adapter = createTrackerAdapter(config as any);
                        const issueData = await (adapter as JiraTrackerAdapter).fetchJiraIssue(issueKey);
                        if (token.isCancellationRequested) { return; }

                        progress.report({ message: 'AI is generating work plan...' });

                        if (!isDevMode() && !(await licenseManager.checkFeatureUsage('ai_plan'))) {
                            return;
                        }

                        const result = await generateWorkPlan(issueData as any, (config as any).llmApiKey, token);
                        if (token.isCancellationRequested) { return; }

                        plannerView.show(result.plan, issueKey);
                        vscode.window.showInformationMessage(`📋 ${issueKey} work plan generated (${result.provider}: ${result.model})`);
                    } catch (err: any) {
                        if (!token.isCancellationRequested) {
                            vscode.window.showErrorMessage(`Work plan generation failed: ${err.message}`);
                        }
                    }
                }
            );
        }
    );

    // ── Start Tracking ──
    const startTrackingDisposable = vscode.commands.registerCommand(
        'orx.startTracking',
        async () => {
            if (tracker.tracking) {
                vscode.window.showWarningMessage('Already tracking.');
                return;
            }
            const issueKey = await promptIssueKey();
            if (!issueKey) { return; }

            await tracker.start(issueKey);
            terminalListener.startListening(); // Phase 4: terminal capture
            vscode.window.showInformationMessage(`🔴 Tracking started: ${issueKey}`);
        }
    );

    // ── Stop Tracking ──
    const stopTrackingDisposable = vscode.commands.registerCommand(
        'orx.stopTracking',
        async () => {
            if (!tracker.tracking) {
                vscode.window.showWarningMessage('Not currently tracking.');
                return;
            }
            const session = await memoryManager.endSession();
            tracker.stop();
            terminalListener.stopListening(); // Phase 4: terminal capture stop

            if (session) {
                const stats = {
                    files: session.fileChanges.length,
                    terminal: session.terminalEntries.length,
                    chats: session.chatEntries.length,
                };
                vscode.window.showInformationMessage(
                    `⏹ Tracking stopped: ${session.issueKey} | Files: ${stats.files} | Terminal: ${stats.terminal} | Chat: ${stats.chats}`
                );
            }
        }
    );

    // ── Toggle Tracking ──
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

    // ── Chat Participant (@agent) registration ──
    const chatParticipantDisposable = registerChatParticipant(memoryManager);

    // ── Finish Work & Report (Phase 5: React Webview) ──
    const finishAndReportDisposable = vscode.commands.registerCommand(
        'orx.finishAndReport',
        async () => {
            const session = memoryManager.getSession();
            if (!session) {
                vscode.window.showWarningMessage('No active tracking session. Please start tracking first.');
                return;
            }

            const config = await validateConfig();
            if (!config) { return; }

            if (tracker.tracking) { tracker.stop(); }
            await memoryManager.endSession();

            // Webview action handler — receives events from ReportPanel
            const handleReportAction = async (msg: WebviewToExtMessage): Promise<void> => {
                const adapter = createTrackerAdapter(config as any);
                switch (msg.type) {
                    case 'action:sendToTracker':
                        await exportManager.exportToTracker(adapter, msg.payload.issueKey, msg.payload.markdown);
                        // Jira: offer status transition
                        if (adapter instanceof JiraTrackerAdapter) {
                            try {
                                const transitions = await adapter.getTransitions(msg.payload.issueKey);
                                if (transitions.length > 0) {
                                    const selected = await vscode.window.showQuickPick(
                                        transitions.map(t => ({ label: t.name, id: t.id })),
                                        { placeHolder: 'Change issue status? (ESC to skip)' }
                                    );
                                    if (selected) {
                                        await adapter.updateIssue(msg.payload.issueKey, '', selected.label);
                                        vscode.window.showInformationMessage(`📝 ${msg.payload.issueKey} status → ${selected.label}`);
                                    }
                                }
                            } catch { /* status transition failure — ignored */ }
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
                        // AI report regeneration
                        const reportPanel = ReportPanel.createOrShow(context.extensionUri, handleReportAction);
                        reportPanel.sendStatus('loading', 'AI is regenerating the report...');
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
                            reportPanel.sendStatus('error', `Regeneration failed: ${err.message}`);
                        }
                        break;
                    }

                    case 'action:editReport':
                        // Handled in Webview — Extension Host caches latest markdown
                        break;
                }
            };

            // Open ReportPanel
            const reportPanel = ReportPanel.createOrShow(context.extensionUri, handleReportAction);
            reportPanel.sendStatus('loading', 'Generating report...');

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Generating report: ${session.issueKey}`, cancellable: true },
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
                                progress.report({ message: 'AI is composing the work report...' });
                                try {
                                    const result = await generateReport(session, (config as any).llmApiKey, token);
                                    reportText = result.report;
                                    provider = result.provider;
                                    model = result.model;
                                } catch (llmErr) {
                                    logger.error('LLM report generation failed, falling back to simple report', llmErr);
                                    reportText = generateSimpleReport(session);
                                }
                            }
                        } else {
                            reportText = generateSimpleReport(session);
                        }

                        if (token.isCancellationRequested) { return; }

                        // Phase 4: Dashboard payload build
                        const gitDiff = await gitDiffCollector.collect().catch((err) => {
                            logger.warn(`Git diff collection failed: ${err instanceof Error ? err.message : String(err)}`);
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

                        // Phase 5: Send report to React Webview
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
                            reportPanel.sendStatus('error', `Report generation failed: ${err.message}`);
                            vscode.window.showErrorMessage(`Report generation failed: ${err.message}`);
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
        // treeView, connectionManager are already registered in activate()
        ...treeActionDisposables,
    );
}

// ─── Common Utilities ───

async function promptIssueKey(): Promise<string | undefined> {
    const input = await vscode.window.showInputBox({
        prompt: 'Enter the issue key',
        placeHolder: 'PROJ-123',
        validateInput: (value) => {
            if (!/^[A-Z][A-Z0-9_]+-\d+$/i.test(value.trim())) {
                return 'Invalid issue key format (e.g. PROJ-123)';
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
        const openSettings = 'Open Settings';
        const selection = await vscode.window.showErrorMessage(err.message, openSettings);
        if (selection === openSettings) {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'orx');
        }
        return null;
    }
}

/**
 * Returns the appropriate TrackerAdapter implementation based on config.
 * Currently only Jira is supported; GitHub/Linear to be added later.
 */
function createTrackerAdapter(config: import('./config').TrackerConfig) {
    switch (config.platform) {
        case 'jira-cloud':
        case 'jira-server':
            return new JiraTrackerAdapter(config);
        default:
            // TODO: Add GitHubTrackerAdapter, LinearTrackerAdapter
            console.warn(`[Orx] Unsupported platform: ${config.platform}. Falling back to Jira.`);
            return new JiraTrackerAdapter(config);
    }
}

/**
 * Summarizes an issue using VS Code's active AI provider.
 * Exported for use from issueDashboard.ts and other modules.
 */
export async function summarizeWithActiveAI(
    issue: import('./adapters/JiraTrackerAdapter').JiraIssueData,
    apiKey: string
): Promise<void> {
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `AI Summary: ${issue.key}`, cancellable: true },
        async (_progress, token) => {
            try {
                if (!isDevMode() && !(await licenseManager.checkFeatureUsage('ai_summary'))) {
                    return;
                }

                const issueContext = `# ${issue.key}: ${issue.summary}\n\nStatus: ${issue.status}\n\nDescription:\n${issue.description ?? '_None_'}`;
                const result = await sendLlmRequest(
                    [
                        {
                            role: 'system',
                            content: `You are a senior software engineer. Summarize the issue concisely.
Include the following:
1. Summary (2-3 lines)
2. Key considerations before starting work
3. Expected timeline (rough estimate)`,
                        },
                        { role: 'user', content: issueContext },
                    ],
                    apiKey,
                    token
                );

                if (token.isCancellationRequested) { return; }

                const header = `# 🤖 AI Summary: ${issue.key}\n> by **${result.model}** (${result.provider})\n\n---\n\n`;
                const doc = await vscode.workspace.openTextDocument({ content: header + result.text, language: 'markdown' });
                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });

                vscode.window.showInformationMessage(`🤖 ${issue.key} AI summary complete (${result.provider})`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`AI summary failed: ${err.message}`);
            }
        }
    );
}

export function deactivate() {}
