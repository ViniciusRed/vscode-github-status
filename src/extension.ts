import * as vscode from "vscode";
import GitHubService from "./service/github";

const statusBarIcon = vscode.window.createStatusBarItem(
  vscode.StatusBarAlignment.Left
);
statusBarIcon.text = "$(pulse) Sending to GitHub status...";

let config = vscode.workspace.getConfiguration("githubstatus");
let interval: NodeJS.Timeout | null = null;
let gitHubService: GitHubService;
let isActive = false; // Track activation status

export async function activate(context: vscode.ExtensionContext) {
  statusBarIcon.show();
  
  // Check blacklist
  const folders = vscode.workspace.workspaceFolders;
  const blacklist = config.get<string[]>("blacklist") || [];
  
  if (!folders || blacklist.includes(folders[0].uri.fsPath)) {
    statusBarIcon.text = "GitHub Status Blacklisted";
    statusBarIcon.command = "githubstatus.toggleBlacklist";
    statusBarIcon.tooltip = "Click to remove from blacklist";
    isActive = false;
    return;
  }

  const token = config.get<string>("token");
  gitHubService = new GitHubService(token, context);
  
  if (gitHubService.received && vscode.workspace.name) {
    interval = await gitHubService.updateStatus(vscode.workspace.name);
    isActive = true;
  }
  
  statusBarIcon.text = "GitHub Status Syncing";
  statusBarIcon.command = "githubstatus.showMenu";
  statusBarIcon.tooltip = "Click to open GitHub Status menu";

  try {
    // Create Token Command
    let createTokenCmd = vscode.commands.registerCommand(
      "githubstatus.createToken",
      async () => {
        try {
          const info = await vscode.window.showInformationMessage(
            "This extension requires a GitHub token with the [user] permission. To create a token, click the button",
            { modal: true },
            "Create Token"
          );
          if (info) {
            await vscode.env.openExternal(
              vscode.Uri.parse("https://github.com/settings/tokens")
            );
            vscode.commands.executeCommand("githubstatus.accessToken");
          }
        } catch (err) {
          console.error(err);
        }
      }
    );

    // Access Token Command
    let accessTokenCmd = vscode.commands.registerCommand(
      "githubstatus.accessToken",
      async () => {
        try {
          const newToken = await vscode.window.showInputBox({
            prompt: "Enter the GitHub access token here",
            password: true,
          });
          if (!newToken) {
            vscode.commands.executeCommand("githubstatus.accessToken");
          } else {
            await config.update("token", newToken, vscode.ConfigurationTarget.Global);
            vscode.commands.executeCommand("githubstatus.restart");
          }
        } catch (err) {
          console.error(err);
        }
      }
    );

    // Show Menu Command
    let showMenuCmd = vscode.commands.registerCommand(
      "githubstatus.showMenu",
      async () => {
        const options = [
          {
            label: "$(sync) Restart Status",
            detail: "Restart the GitHub status synchronization",
            action: "restart"
          },
          // Dynamic activate/deactivate option
          isActive ? {
            label: "$(stop-circle) Deactivate Status",
            detail: "Stop GitHub status synchronization and set idle",
            action: "deactivate"
          } : {
            label: "$(play-circle) Activate Status",
            detail: "Start GitHub status synchronization",
            action: "activate"
          },
          {
            label: "$(settings-gear) Select Emoji",
            detail: "Choose a new emoji for your status",
            action: "selectEmoji"
          },
          {
            label: "$(exclude) Toggle Blacklist",
            detail: "Add/remove current workspace from blacklist",
            action: "toggleBlacklist"
          }
        ];

        const selected = await vscode.window.showQuickPick(options, {
          placeHolder: "Choose an action for GitHub Status"
        });

        if (selected) {
          switch (selected.action) {
            case "restart":
              vscode.commands.executeCommand("githubstatus.restart");
              break;
            case "deactivate":
              vscode.commands.executeCommand("githubstatus.deactivate");
              break;
            case "activate":
              vscode.commands.executeCommand("githubstatus.activate");
              break;
            case "selectEmoji":
              vscode.commands.executeCommand("githubstatus.selectEmoji");
              break;
            case "toggleBlacklist":
              vscode.commands.executeCommand("githubstatus.toggleBlacklist");
              break;
          }
        }
      }
    );

    // Select Emoji Command
    let selectEmojiCmd = vscode.commands.registerCommand(
      "githubstatus.selectEmoji",
      async () => {
        if (gitHubService) {
          const selectedEmoji = await gitHubService.selectEmoji();
          if (selectedEmoji) {
            await config.update("emoji", selectedEmoji, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Emoji updated to :${selectedEmoji}:`);
            // Restart to apply the new emoji if currently active
            if (isActive) {
              vscode.commands.executeCommand("githubstatus.restart");
            }
          }
        }
      }
    );

    // Toggle Blacklist Command
    let toggleBlacklistCmd = vscode.commands.registerCommand(
      "githubstatus.toggleBlacklist",
      async () => {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) {
          vscode.window.showErrorMessage("No workspace folder found");
          return;
        }

        const workspacePath = folders[0].uri.fsPath;
        const blacklist = config.get<string[]>("blacklist") || [];
        const isBlacklisted = blacklist.includes(workspacePath);

        if (isBlacklisted) {
          // Remove from blacklist
          const newBlacklist = blacklist.filter(path => path !== workspacePath);
          await config.update("blacklist", newBlacklist, vscode.ConfigurationTarget.Global);
          vscode.window.showInformationMessage("Workspace removed from blacklist");
          vscode.commands.executeCommand("githubstatus.restart");
        } else {
          // Add to blacklist
          const newBlacklist = [...blacklist, workspacePath];
          await config.update("blacklist", newBlacklist, vscode.ConfigurationTarget.Global);
          vscode.window.showInformationMessage("Workspace added to blacklist");
          deactivate();
          statusBarIcon.text = "GitHub Status Blacklisted";
          statusBarIcon.command = "githubstatus.toggleBlacklist";
          statusBarIcon.tooltip = "Click to remove from blacklist";
          isActive = false;
        }
      }
    );

    // Restart Command
    let restartCmd = vscode.commands.registerCommand(
      "githubstatus.restart",
      () => {
        console.log("Restart");
        config = vscode.workspace.getConfiguration("githubstatus");
        activate(context);
      }
    );

    // Activate Command (new)
    let activateCmd = vscode.commands.registerCommand(
      "githubstatus.activate",
      async () => {
        console.log("Activating");
        if (gitHubService && vscode.workspace.name) {
          gitHubService.resetActivity(); // Reset idle state
          interval = await gitHubService.updateStatus(vscode.workspace.name);
          statusBarIcon.text = "GitHub Status Syncing";
          statusBarIcon.tooltip = "Click to open GitHub Status menu";
          isActive = true;
          vscode.window.showInformationMessage("GitHub Status activated");
        }
      }
    );

    // Deactivate Command
    let deactivateCmd = vscode.commands.registerCommand(
      "githubstatus.deactivate",
      async () => {
        console.log("Deactivating");
        await deactivate();
        // Set user's default status message
        if (gitHubService) {
          await gitHubService.setDefault();
        }
        statusBarIcon.text = "GitHub Status Not Syncing";
        statusBarIcon.tooltip = "Click to open GitHub Status menu";
        isActive = false;
        vscode.window.showInformationMessage("GitHub Status deactivated");
      }
    );

    context.subscriptions.push(
      createTokenCmd,
      accessTokenCmd,
      showMenuCmd,
      selectEmojiCmd,
      toggleBlacklistCmd,
      restartCmd,
      activateCmd,
      deactivateCmd
    );
  } catch (error) {
    console.log("Extension initialization error:", error);
  }
}

export async function deactivate() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  
  // Don't change status bar text here as it's handled by the calling command
  // Only clear interval and reset gitHubService to default if fully deactivating
  if (gitHubService && !isActive) {
    await gitHubService.setDefault();
  }
}