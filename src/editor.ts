import * as vscode from 'vscode';

// Possible positions when C-l is invoked consequtively
enum RecenterPosition {
  Middle,
  Top,
  Bottom
};

export class Editor {
	private lastKill: vscode.Position // if kill position stays the same, append to clipboard
	private justDidKill: boolean
	private centerState: RecenterPosition

	constructor() {
		this.justDidKill = false
		this.lastKill = null
		this.centerState = RecenterPosition.Middle

		vscode.window.onDidChangeActiveTextEditor(event => {
			this.lastKill = null
		})
		vscode.workspace.onDidChangeTextDocument(event => {
			if (!this.justDidKill) {
				this.lastKill = null
			}
			this.justDidKill = false
		})
		vscode.window.onDidChangeTextEditorSelection(event => {
			this.centerState = RecenterPosition.Middle
		})
	}

	static isOnLastLine(): boolean {
		return vscode.window.activeTextEditor.selection.active.line == vscode.window.activeTextEditor.document.lineCount - 1
	}

	setStatusBarMessage(text: string): vscode.Disposable {
		return vscode.window.setStatusBarMessage(text, 1000);
	}

	setStatusBarPermanentMessage(text: string): vscode.Disposable {
		return vscode.window.setStatusBarMessage(text);
	}

	getSelectionRange(): vscode.Range {
		let selection = vscode.window.activeTextEditor.selection,
			start = selection.start,
			end = selection.end;

		return (start.character !== end.character || start.line !== end.line) ? new vscode.Range(start, end) : null;
	}

	getSelection(): vscode.Selection {
		return vscode.window.activeTextEditor.selection;
	}

	getSelectionText(): string {
        return this.getTextInRange(this.getSelectionRange())
    }
    
    getTextInRange(range: vscode.Range): string {
        return range ? vscode.window.activeTextEditor.document.getText(range) : ''
    }

	setSelection(start: vscode.Position, end: vscode.Position): void {
		let editor = vscode.window.activeTextEditor;
		editor.selection = new vscode.Selection(start, end);
	}

	getCurrentPos(): vscode.Position {
		return vscode.window.activeTextEditor.selection.active
	}

	// Kill to end of line
	async kill(): Promise<boolean> {
		// Ignore whatever we have selected before
		await vscode.commands.executeCommand("emacs.exitMarkMode")

		let startPos = this.getCurrentPos(),
            isOnLastLine = Editor.isOnLastLine();
            
        // cut from current pos to start of next line
        let endPos: vscode.Position;
        if(isOnLastLine) { // "next line" doesn't exist on the last line
            endPos = vscode.window.activeTextEditor.document.lineAt(startPos.line).range.end;
        } else {
            endPos = vscode.window.activeTextEditor.document.lineAt(startPos.line+1).range.start;
        }

		let range = new vscode.Range(startPos, endPos);
		let	txt = vscode.window.activeTextEditor.document.getText(range);

		// If we have anything other than whitespace in our selection, we need to only cut the line we're on (only remove entirely empty selections)
		if(!isOnLastLine && !txt.match(/^\s*$/)) {
            let currentLine = vscode.window.activeTextEditor.document.lineAt(startPos.line);
            endPos = currentLine.range.end;
            
            // Update range with new endPos
            range = new vscode.Range(startPos, endPos);
        }

		// Cut text out of range
		let promise = this.cut_range(range, this.lastKill != null && startPos.isEqual(this.lastKill))

		promise.then(() => {
			this.justDidKill = true
			this.lastKill = startPos
		})

		return promise
	}

	copy(): void {
		vscode.env.clipboard.writeText(this.getSelectionText())
		vscode.commands.executeCommand("emacs.exitMarkMode")
    }
    
    cut() {
        vscode.env.clipboard.writeText(this.getSelectionText())
        let t = Editor.delete(this.getSelectionRange());
		vscode.commands.executeCommand("emacs.exitMarkMode");
		return t
    }
    
	async cut_range(range: vscode.Range, appendClipboard?: boolean): Promise<boolean> {
        let rangeText = this.getTextInRange(range);
        
		if (appendClipboard) {
			const text = await vscode.env.clipboard.readText();
            vscode.env.clipboard.writeText(text + rangeText)
		} else {
			vscode.env.clipboard.writeText(rangeText)
        }
        
		let t = Editor.delete(range);
		vscode.commands.executeCommand("emacs.exitMarkMode");
		return t
	}

	yank(): Thenable<{}> {
		this.justDidKill = false
		return Promise.all([
			vscode.commands.executeCommand("editor.action.clipboardPasteAction"),
			vscode.commands.executeCommand("emacs.exitMarkMode")])
	}

	undo(): void {
		vscode.commands.executeCommand("undo");
	}

	private getFirstBlankLine(range: vscode.Range): vscode.Range {
		let doc = vscode.window.activeTextEditor.document;

		if (range.start.line === 0) {
			return range;
		}
		range = doc.lineAt(range.start.line - 1).range;
		while (range.start.line > 0 && range.isEmpty) {
			range = doc.lineAt(range.start.line - 1).range;
		}
		if (range.isEmpty) {
			return range;
		} else {
			return doc.lineAt(range.start.line + 1).range;
		}
	}

	async deleteBlankLines() {
		let selection = this.getSelection(),
			anchor = selection.anchor,
			doc = vscode.window.activeTextEditor.document,
			range = doc.lineAt(selection.start.line).range,
			nextLine: vscode.Position;

		if (range.isEmpty) {
			range = this.getFirstBlankLine(range);
			anchor = range.start;
			nextLine = range.start;
		} else {
			nextLine = range.start.translate(1, 0);
		}
		selection = new vscode.Selection(nextLine, nextLine);
		vscode.window.activeTextEditor.selection = selection;

		for (let line = selection.start.line;
				line < doc.lineCount - 1  && doc.lineAt(line).range.isEmpty;
		    	++line) {

			await vscode.commands.executeCommand("deleteRight")
		}
		vscode.window.activeTextEditor.selection = new vscode.Selection(anchor, anchor)
	}

	static delete(range: vscode.Range = null): Thenable<boolean> {
		if (range) {
			return vscode.window.activeTextEditor.edit(editBuilder => {
				editBuilder.delete(range);
			});
		}
	}

	deleteLine() : void {
		vscode.commands.executeCommand("emacs.exitMarkMode"); // emulate Emacs
		vscode.commands.executeCommand("editor.action.deleteLines");
	}

	scrollLineToCenterTopBottom = () => {
		const editor = vscode.window.activeTextEditor
		const selection = editor.selection

		switch (this.centerState) {
			case RecenterPosition.Middle:
				this.centerState = RecenterPosition.Top;
				editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
				break;
			case RecenterPosition.Top:
				this.centerState = RecenterPosition.Bottom;
				editor.revealRange(selection, vscode.TextEditorRevealType.AtTop);
				break;
			case RecenterPosition.Bottom:
				this.centerState = RecenterPosition.Middle;
				// There is no AtBottom, so instead scroll a page up (without moving cursor).
				// The current line then ends up as the last line of the window (more or less)
				vscode.commands.executeCommand("scrollPageUp");
				break;
		}
	}

	breakLine() {
		vscode.commands.executeCommand("lineBreakInsert");
		vscode.commands.executeCommand("emacs.cursorHome");
		vscode.commands.executeCommand("emacs.cursorDown");
	}
}
