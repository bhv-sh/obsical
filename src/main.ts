
import { Plugin, PluginSettingTab, Setting, Notice, App, TFile } from "obsidian";

// =====================
// Settings interface
// =====================
interface MyPluginSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
  clientId: "",
  clientSecret: "",
  redirectUri: "http://localhost",
};

// =====================
// Regex for #event at end
// Example: Test Event 202601312030:202601312200 #event
// =====================
const EVENT_REGEX = /^(.*?)\s+(\d{12}):(\d{12})\s*#event$/;

// =====================
// Main plugin
// =====================
export default class MyPlugin extends Plugin {
  settings: MyPluginSettings;

  async onload() {
    // Load settings
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    // Register settings tab
    this.addSettingTab(new MyPluginSettingTab(this.app, this));

    // Auto-detect #event lines on file save
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile)) return;
        if (file.extension !== "md") return;
        this.createEventsFromFile(file);
      })
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // =====================
  // Process #event lines in a file
  // =====================
  async createEventsFromFile(file?: TFile) {
    const activeFile = file || this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile)) {
      new Notice("No active Markdown file");
      return;
    }

    const content = await this.app.vault.read(activeFile);
    const lines = content.split("\n");

    let changed = false;
    const updatedLines: string[] = [];

    for (const line of lines) {
      const lineTrimmed = line.trim();

      // Skip already processed lines
      if (lineTrimmed.endsWith("✔")) {
        updatedLines.push(line);
        continue;
      }

      const match = lineTrimmed.match(EVENT_REGEX);
      if (!match) {
        updatedLines.push(line);
        continue;
      }

      const title = (match[1] ?? "Event").trim();
      const startRaw = match[2];
      const endRaw = match[3];

      if (!startRaw || !endRaw) {
        new Notice(`Invalid event line: ${line}`);
        updatedLines.push(line);
        continue;
      }

      try {
        await this.createGoogleEvent(title, startRaw, endRaw);
        updatedLines.push(line + " ✔");
        changed = true;
      } catch (e) {
        console.error(e);
        new Notice(`Failed to create event: ${title}`);
        updatedLines.push(line);
      }
    }

    if (changed) {
      await this.app.vault.modify(activeFile, updatedLines.join("\n"));
      new Notice("Events created");
    }
  }

  // =====================
  // Convert YYYYMMDDHHmm → ISO string
  // =====================
  toISO(raw: string): string {
    return (
      raw.slice(0, 4) +
      "-" +
      raw.slice(4, 6) +
      "-" +
      raw.slice(6, 8) +
      "T" +
      raw.slice(8, 10) +
      ":" +
      raw.slice(10, 12) +
      ":00"
    );
  }

  // =====================
  // Create event in Google Calendar
  // =====================
  async createGoogleEvent(title: string, startRaw: string, endRaw: string) {
    const startISO = this.toISO(startRaw);
    const endISO = this.toISO(endRaw);

    const token = await this.getAccessToken();

    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: title,
          start: { dateTime: startISO, timeZone: "Europe/Dublin" },
          end: { dateTime: endISO, timeZone: "Europe/Dublin" },
        }),
      }
    );

    if (!res.ok) {
      throw new Error(await res.text());
    }
  }

  // =====================
  // Get access token (OAuth)
  // =====================
  async getAccessToken(): Promise<string> {
    if (!this.settings.clientId || !this.settings.clientSecret) {
      new Notice("Please set your Client ID and Client Secret in plugin settings.");
      throw new Error("Missing OAuth credentials");
    }

    const data: {
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
    } = (await this.loadData()) || {};

    // Use valid token
    if (data.access_token && data.expires_at && Date.now() < data.expires_at) {
	  return data.access_token!;
	}

    // Refresh token if available
    if (data.refresh_token) {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.settings.clientId,
          client_secret: this.settings.clientSecret,
          refresh_token: data.refresh_token,
          grant_type: "refresh_token",
        }),
      });

      if (!res.ok) throw new Error(`Failed to refresh token: ${await res.text()}`);

      const json = await res.json();
      data.access_token = json.access_token;
      data.expires_at = Date.now() + (json.expires_in ?? 3600) * 1000;
      await this.saveData(data);
      return data.access_token!;
    }

    // First-time OAuth
    const authUrl =
      "https://accounts.google.com/o/oauth2/v2/auth?" +
      new URLSearchParams({
        client_id: this.settings.clientId,
        redirect_uri: this.settings.redirectUri || "http://localhost",
        response_type: "code",
        scope: "https://www.googleapis.com/auth/calendar.events",
        access_type: "offline",
        prompt: "consent",
      });

    window.open(authUrl.toString(), "_blank");
    new Notice("Authorize Google Calendar, then paste the code into the prompt");

    const code = await this.waitForAuthCode();
    if (!code) throw new Error("Authorization code not provided");

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.settings.clientId,
        client_secret: this.settings.clientSecret,
        redirect_uri: this.settings.redirectUri || "http://localhost",
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) throw new Error(`Failed to get token: ${await tokenRes.text()}`);

    const tokenJson = await tokenRes.json();

    await this.saveData({
      access_token: tokenJson.access_token,
      refresh_token: tokenJson.refresh_token,
      expires_at: Date.now() + (tokenJson.expires_in ?? 3600) * 1000,
    });

    return tokenJson.access_token;
  }

  // =====================
  // Prompt user for OAuth code
  // =====================
  async waitForAuthCode(): Promise<string> {
    return new Promise((resolve) => {
      const code = prompt("Paste the Google authorization code here:");
      resolve(code || "");
    });
  }
}

// =====================
// Settings tab
// =====================
class MyPluginSettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Google Calendar Plugin Settings" });

    new Setting(containerEl)
      .setName("Client ID")
      .setDesc("Your Google OAuth Client ID")
      .addText((text) =>
        text
          .setPlaceholder("Enter Client ID")
          .setValue(this.plugin.settings.clientId)
          .onChange(async (value) => {
            this.plugin.settings.clientId = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Client Secret")
      .setDesc("Your Google OAuth Client Secret")
      .addText((text) =>
        text
          .setPlaceholder("Enter Client Secret")
          .setValue(this.plugin.settings.clientSecret)
          .onChange(async (value) => {
            this.plugin.settings.clientSecret = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Redirect URI")
      .setDesc("Redirect URI for OAuth (default http://localhost)")
      .addText((text) =>
        text
          .setPlaceholder("Enter Redirect URI")
          .setValue(this.plugin.settings.redirectUri)
          .onChange(async (value) => {
            this.plugin.settings.redirectUri = value.trim();
            await this.plugin.saveSettings();
          })
      );
  }
}
