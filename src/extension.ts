// extension.ts
import * as vscode from 'vscode';
import * as dotenv from 'dotenv';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { askGemini } from './gemini';

dotenv.config({ path: `${__dirname}/../.env` });

let tempFilePath: string | null = null;

export function activate(context: vscode.ExtensionContext) {

    context.subscriptions.push(
        vscode.commands.registerCommand('geminiCodeHelper.resolveChanges', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const originalText = editor.document.getText();
            const position = editor.selection.active;

            try {
                const generated = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Generating AI suggestions...",
                    cancellable: false
                }, async () => {
                    const prompt = buildPrompt(editor.document, position);
                    const result = await askGemini(prompt);
                    return result;
                });

                // Create temp file with AI suggestions
                tempFilePath = join(tmpdir(), `gemini-${Date.now()}.${getFileExtension(editor.document)}`);
                writeFileSync(tempFilePath, generated);

                // Show diff view
                await vscode.commands.executeCommand('vscode.diff',
                    editor.document.uri,
                    vscode.Uri.file(tempFilePath),
                    'Original ↔ Gemini Suggestions',
                    { preview: false }
                );

                // Add accept/reject buttons to toolbar
                vscode.commands.executeCommand('setContext', 'inGeminiDiffView', true);

            } catch (error) {
                vscode.window.showErrorMessage(`AI suggestion failed: ${error}`);
                cleanupTempFile();
            }
        }),

        // Accept AI changes
        vscode.commands.registerCommand('geminiCodeHelper.acceptIncoming', async () => {
            await applyChanges();
            cleanupTempFile();
        }),

        // Reject AI changes
        vscode.commands.registerCommand('geminiCodeHelper.rejectChanges', () => {
            vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            cleanupTempFile();
        })
    );
}

async function applyChanges() {
    const diffEditor = vscode.window.activeTextEditor;
    if (!diffEditor || !diffEditor.document.uri.fsPath.includes('gemini-')) return;

    const originalEditor = vscode.window.visibleTextEditors.find(
        e => !e.document.uri.fsPath.includes('gemini-')
    );

    if (originalEditor) {
        const fullText = diffEditor.document.getText();
        await originalEditor.edit(editBuilder => {
            const fullRange = new vscode.Range(
                originalEditor.document.positionAt(0),
                originalEditor.document.positionAt(originalEditor.document.getText().length)
            );
            editBuilder.replace(fullRange, fullText);
        });
        vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
}

function cleanupTempFile() {
    if (tempFilePath) {
        try { unlinkSync(tempFilePath); } catch {} 
        tempFilePath = null;
    }
}

function buildPrompt(document: vscode.TextDocument, position: vscode.Position): string {
    const line = position.line;
    const startLine = Math.max(0, line - 5);
    const range = new vscode.Range(
        new vscode.Position(startLine, 0),
        position
    );
    return `Complete this code. Only respond with the code completion, no explanation, no code block for text.
  
Current code context:
${document.getText(range)}

Code completion:`;
}

function getFileExtension(document: vscode.TextDocument): string {
    return document.languageId || document.fileName.split('.').pop() || 'txt';
}

export function deactivate() {
    cleanupTempFile();
}