import * as vscode from "vscode";
import { graphql as gitHubApi } from "@octokit/graphql";
import { RequestParameters, graphql } from "@octokit/graphql/dist-types/types";
import moment from "moment";

interface IEnv {
  [key: string]: string | undefined;
}

interface GitHubEmoji {
  [key: string]: string;
}

interface EmojiCacheItem {
  name: string;
  url: string;
}

const OFFSET = 10000;
const EMOJI_CACHE_KEY = 'githubstatus.emojiCache';
const EMOJI_CACHE_TIMESTAMP_KEY = 'githubstatus.emojiCacheTimestamp';
const CACHE_EXPIRY_HOURS = 24; // Cache emojis for 24 hours

const changeUserStatusMutation = `
  mutation ($status: ChangeUserStatusInput!) {
    changeUserStatus(input: $status) {
      status {
        emoji
        expiresAt
        limitedAvailability: indicatesLimitedAvailability
        message
      }
    }
  }
`;

export default class {
  private __api: graphql;
  private __expires = 1;
  private __start?: moment.Moment;
  private __currentLanguage?: string;
  private __emojis: GitHubEmoji = {};
  private __emojiCache: EmojiCacheItem[] = [];
  private __context?: vscode.ExtensionContext;
  private __lastActivity: moment.Moment;
  private __idleTimeout = 15; // minutes of inactivity before going idle
  private __isIdle = false;
  public received = false;

  constructor(token?: string, context?: vscode.ExtensionContext) {
    const config: RequestParameters = {};

    this.__expires =
      vscode.workspace.getConfiguration("githubstatus").get("interval") ?? 1;

    this.__idleTimeout =
      vscode.workspace.getConfiguration("githubstatus").get("idleTimeout") ?? 15;

    this.__lastActivity = moment();

    if (context) {
      this.__context = context;
    }

    if (token) {
      this.received = true;
      config.headers = { authorization: `token ${token}` };
    } else {
      // Get token
      vscode.commands.executeCommand("githubstatus.createToken");
    }
    this.__api = gitHubApi.defaults(config);

    // Load emojis from cache or GitHub API
    this.loadEmojis();

    // Track user activity for idle detection
    vscode.workspace.onDidSaveTextDocument((e) => {
      this.__currentLanguage = e.languageId;
      this.onActivity();
    });

    vscode.workspace.onDidChangeTextDocument(() => {
      this.onActivity();
    });

    vscode.window.onDidChangeTextEditorSelection(() => {
      this.onActivity();
    });

    vscode.window.onDidChangeActiveTextEditor(() => {
      this.onActivity();
    });

    vscode.window.onDidChangeTextEditorVisibleRanges(() => {
      this.onActivity();
    });
  }

  private onActivity(): void {
    this.__lastActivity = moment();
    if (this.__isIdle) {
      this.__isIdle = false;
      // Resume active status if we were idle
      if (vscode.workspace.name) {
        this.updateStatus(vscode.workspace.name);
      }
    }
  }

  private async loadEmojis(): Promise<void> {
    try {
      // Check if we have valid cached emojis
      const cachedEmojis = await this.getCachedEmojis();
      if (cachedEmojis && cachedEmojis.length > 0) {
        this.__emojiCache = cachedEmojis;
        // Convert to old format for backward compatibility
        this.__emojis = {};
        cachedEmojis.forEach(emoji => {
          this.__emojis[emoji.name] = emoji.url;
        });
        return;
      }

      // Fetch fresh emojis from GitHub API
      const response = await fetch("https://api.github.com/emojis");
      if (response.ok) {
        this.__emojis = await response.json() as GitHubEmoji;
        
        // Convert to cache format
        this.__emojiCache = Object.entries(this.__emojis).map(([name, url]) => ({
          name,
          url
        }));

        // Cache the emojis
        await this.cacheEmojis(this.__emojiCache);
      }
    } catch (error) {
      console.error("Failed to load emojis:", error);
      // Fallback to default emojis
      this.__emojis = {
        "computer": "https://github.githubassets.com/images/icons/emoji/unicode/1f4bb.png?v8",
        "rocket": "https://github.githubassets.com/images/icons/emoji/unicode/1f680.png?v8",
        "zap": "https://github.githubassets.com/images/icons/emoji/unicode/26a1.png?v8",
        "coffee": "https://github.githubassets.com/images/icons/emoji/unicode/2615.png?v8",
        "fire": "https://github.githubassets.com/images/icons/emoji/unicode/1f525.png?v8",
        "house": "https://github.githubassets.com/images/icons/emoji/unicode/1f3e0.png?v8"
      };

      this.__emojiCache = Object.entries(this.__emojis).map(([name, url]) => ({
        name,
        url
      }));
    }
  }

  private async getCachedEmojis(): Promise<EmojiCacheItem[] | null> {
    if (!this.__context) return null;

    try {
      const cachedEmojis = this.__context.globalState.get<EmojiCacheItem[]>(EMOJI_CACHE_KEY);
      const cacheTimestamp = this.__context.globalState.get<number>(EMOJI_CACHE_TIMESTAMP_KEY);

      if (!cachedEmojis || !cacheTimestamp) {
        return null;
      }

      // Check if cache is still valid (24 hours)
      const now = Date.now();
      const cacheAge = now - cacheTimestamp;
      const maxAge = CACHE_EXPIRY_HOURS * 60 * 60 * 1000; // Convert to milliseconds

      if (cacheAge > maxAge) {
        return null; // Cache expired
      }

      return cachedEmojis;
    } catch (error) {
      console.error("Failed to load cached emojis:", error);
      return null;
    }
  }

  private async cacheEmojis(emojis: EmojiCacheItem[]): Promise<void> {
    if (!this.__context) return;

    try {
      await this.__context.globalState.update(EMOJI_CACHE_KEY, emojis);
      await this.__context.globalState.update(EMOJI_CACHE_TIMESTAMP_KEY, Date.now());
    } catch (error) {
      console.error("Failed to cache emojis:", error);
    }
  }

  private getEmojiPreview(name: string, url: string): string {
    // Expanded map of common GitHub emoji shortcodes to Unicode
    const emojiMap: { [key: string]: string } = {
      computer: '💻',
      rocket: '🚀',
      zap: '⚡',
      coffee: '☕',
      fire: '🔥',
      house: '🏠',
      zzz: '💤',
      brain: '🧠',
      eyes: '👀',
      hammer: '🔨',
      wrench: '🔧',
      bulb: '💡',
      smile: '😊',
      heart: '❤️',
      thumbsup: '👍',
      thumbsdown: '👎',
      clap: '👏',
      tada: '🎉',
      thinking_face: '🤔',
      joy: '😂'
    };

    // Try to extract Unicode from URL (supports single and multi-codepoint emojis)
    const unicodeMatch = url.match(/\/unicode\/([0-9a-fA-F-]+)\.png/);
    if (unicodeMatch && unicodeMatch[1]) {
      try {
        // Split multi-codepoint emojis (e.g., '1f468-200d-1f469')
        const codePoints = unicodeMatch[1].split('-').filter(code => code !== '200d'); // Ignore zero-width joiner
        const emoji = codePoints
          .map(code => String.fromCodePoint(parseInt(code, 16)))
          .join('');
        return emoji;
      } catch (e) {
        console.error(`Failed to parse Unicode from URL for ${name}:`, e);
      }
    }

    // Fallback to static map or shortcode
    return emojiMap[name] || `:${name}:`;
  }

  public getAvailableEmojis(): EmojiCacheItem[] {
    return this.__emojiCache;
  }

  public async selectEmoji(): Promise<string | undefined> {
    const emojiList = this.getAvailableEmojis();
    
    // Create quick pick items with text-based emoji preview
    const quickPickItems = emojiList.map(emoji => ({
      label: `${this.getEmojiPreview(emoji.name, emoji.url)} :${emoji.name}:`,
      description: emoji.name,
      detail: `${emoji.url}`,
      emoji: emoji.name
    }));

    // Sort by popularity (put common coding/work emojis first)
    const popularEmojis = ['computer', 'rocket', 'zap', 'fire', 'coffee', 'brain', 'eyes', 'hammer', 'wrench', 'bulb'];
    quickPickItems.sort((a, b) => {
      const aIndex = popularEmojis.indexOf(a.emoji);
      const bIndex = popularEmojis.indexOf(b.emoji);
      
      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      } else if (aIndex !== -1) {
        return -1;
      } else if (bIndex !== -1) {
        return 1;
      } else {
        return a.emoji.localeCompare(b.emoji);
      }
    });

    const selectedEmoji = await vscode.window.showQuickPick(
      quickPickItems,
      {
        placeHolder: "Select an emoji for your status (Unicode/shortcode preview in label, URL in detail)",
        matchOnDescription: true,
        matchOnDetail: false,
        canPickMany: false
      }
    );

    return selectedEmoji ? selectedEmoji.emoji : undefined;
  }

  public async updateStatus(workspace: string): Promise<NodeJS.Timeout | null> {
    let emoji = vscode.workspace
      .getConfiguration("githubstatus")
      .get("emoji") as string;

    // If no emoji is configured, let user select one
    if (!emoji) {
      const selectedEmoji = await this.selectEmoji();
      if (selectedEmoji) {
        emoji = selectedEmoji;
        // Save the selected emoji for future use
        await vscode.workspace.getConfiguration("githubstatus").update("emoji", emoji, vscode.ConfigurationTarget.Global);
      } else {
        emoji = "computer"; // Default fallback
      }
    }

    const time = moment(new Date());
    let diff = "";
    let interval: NodeJS.Timeout | null = null;
    
    // Check if user has been idle
    const minutesSinceActivity = time.diff(this.__lastActivity, "minutes");
    if (minutesSinceActivity >= this.__idleTimeout && !this.__isIdle) {
      this.__isIdle = true;
      await this.setIdle();
      return null;
    }

    // If we're idle, don't update active status
    if (this.__isIdle) {
      return null;
    }
    
    if (!this.__start) {
      this.__start = time;
      interval = setInterval(
        () => this.updateStatus(workspace),
        this.__expires * 60000
      );
    } else {
      let diffN = Math.floor(time.diff(this.__start, "minutes"));
      diff = `(${diffN} minute${diffN > 1 ? "s" : ""})`;
      if (diffN > 60) {
        const hours = Math.floor(diffN / 60);
        const minutes = Math.floor(diffN % 60);
        console.log(diffN, time.diff(this.__start, "minutes"), hours, minutes);
        diff = `(${hours} hour${hours > 1 ? "s" : ""} ${minutes} minute${
          minutes > 1 ? "s" : ""
        })`;
      }
    }

    const status: UserStatus = {
      expiresAt: new Date(
        OFFSET + new Date().getTime() + this.__expires * 60000
      ).toISOString(),
      message: `Working on ${workspace}${this.__currentLanguage ? ` in ${this.__currentLanguage}` : ""}${diff.length > 0 ? ` for ${diff}` : ""}`,
      emoji: `:${emoji}:`,
    };
    
    try {
      await this.__api(changeUserStatusMutation, { request: {}, status });
    } catch (err) {
      console.error(err);
    } finally {
      return interval;
    }
  }

  public async setIdle(): Promise<void> {
    const emoji = vscode.workspace
      .getConfiguration("githubstatus")
      .get("emojiDefault") as string || "zzz";
    
    const status: UserStatus = {
      emoji: `:${emoji}:`,
      message: "Idle - Away from keyboard",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour expiry
    };
    
    try {
      await this.__api(changeUserStatusMutation, { request: {}, status });
    } catch (err) {
      console.error(err);
    }
  }

  public resetActivity(): void {
    this.__lastActivity = moment();
    this.__isIdle = false;
    this.__start = undefined; // Reset work timer when resuming from idle
  }

  public async setDefault(): Promise<void> {
    const message = vscode.workspace
      .getConfiguration("githubstatus")
      .get("default") as string;
    if (!message) {
      return;
    }
    const emoji = vscode.workspace
      .getConfiguration("githubstatus")
      .get("emojiDefault") as string;
    
    const status: UserStatus = {
      emoji: emoji ? `:${emoji}:` : undefined,
      message,
    };
    
    try {
      await this.__api(changeUserStatusMutation, { request: {}, status });
    } catch (err) {
      console.error(err);
    }
  }
}

interface UserStatus {
  emoji?: string | null;
  expiresAt?: string | null;
  limitedAvailability?: boolean;
  message?: string | null;
}