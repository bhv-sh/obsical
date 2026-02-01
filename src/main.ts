
import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  requestUrl,
} from "obsidian";

// --------------------
// Types & Defaults
// --------------------
interface GoogleCalendarPluginSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface TokenData {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}

const DEFAULT_SETTINGS: GoogleCalendarPluginSettings = {
  clientId: "",
  clientSecret: "",
  redirectUri: "http://localhost",
};

const EVENT_REGEX = /^(.*?)\s+(\d{12}):(\d{12})\s*#event$/;

// --------------------
// Main Plugin
// --------------------
export default class GoogleCalendarPlugin extends Plugin {
  settings: GoogleCalendarPluginSettings;

  async onload() {

	const data = (await this.loadData()) as TokenData | null ?? {};

    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

    this.addSettingTab(new GoogleCalendarSettingTab(this.app, this));

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile)) return;
        if (file.extension !== "md") return;
        void this.createEventsFromFile(file);
      })
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async createEventsFromFile(file?: TFile) {
    const activeFile = file || this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No active file.");
      return;
    }

    const content = await this.app.vault.read(activeFile);
    const lines = content.split("\n");

    let changed = false;
    const updatedLines: string[] = [];

    for (const line of lines) {
      const lineTrimmed = line.trim();
      if (lineTrimmed.endsWith("✔")) {
        updatedLines.push(line);
        continue;
      }

      const match = lineTrimmed.match(EVENT_REGEX);
      if (!match) {
        updatedLines.push(line);
        continue;
      }

	  const title = (match[1]?.trim() || "Event");
      const startRaw = match[2]!;
      const endRaw = match[3]!;

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
      new Notice("Events created.");
    }
  }

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

  async createGoogleEvent(title: string, startRaw: string, endRaw: string) {
    const startISO = this.toISO(startRaw);
    const endISO = this.toISO(endRaw);
    const token = await this.getAccessToken();

    const res = await requestUrl({
      url: "https://www.googleapis.com/calendar/v3/calendars/primary/events",
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
    });

    if (![200, 201].includes(res.status)) {
      throw new Error(`Error creating event: ${res.text}`);
    }
  }

  async getAccessToken(): Promise<string> {
    if (!this.settings.clientId || !this.settings.clientSecret) {
      new Notice("Set your client ID and client secret in plugin settings.");
      throw new Error("Missing OAuth credentials.");
    }

    const data = (await this.loadData()) as TokenData | null ?? {};

    if (data.access_token && data.expires_at && Date.now() < data.expires_at) {
      return data.access_token;
    }

    if (data.refresh_token) {
      const params = new URLSearchParams({
        client_id: this.settings.clientId,
        client_secret: this.settings.clientSecret,
        refresh_token: data.refresh_token,
        grant_type: "refresh_token",
      }).toString();

      const res = await requestUrl({
        url: "https://oauth2.googleapis.com/token",
        method: "POST",
        contentType: "application/x-www-form-urlencoded",
        body: params,
      });

      const json = JSON.parse(res.text) as TokenData & { expires_in: number };
      data.access_token = json.access_token;
      data.expires_at = Date.now() + json.expires_in * 1000;
      await this.saveData(data);
      return json.access_token!;
    }

    const authUrl =
      "https://accounts.google.com/o/oauth2/v2/auth?" +
      new URLSearchParams({
        client_id: this.settings.clientId,
        redirect_uri: this.settings.redirectUri,
        response_type: "code",
        scope: "https://www.googleapis.com/auth/calendar.events",
        access_type: "offline",
        prompt: "consent",
      }).toString();

    window.open(authUrl, "_blank");
    new AuthCodeModal(this.app).open();
    const code = await AuthCodeModal.waitForCode();

    const tokenParams = new URLSearchParams({
      code,
      client_id: this.settings.clientId,
      client_secret: this.settings.clientSecret,
      redirect_uri: this.settings.redirectUri,
      grant_type: "authorization_code",
    }).toString();

    const tokenRes = await requestUrl({
      url: "https://oauth2.googleapis.com/token",
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: tokenParams,
    });

    const tokenJson = JSON.parse(tokenRes.text) as TokenData & { expires_in: number };
    await this.saveData({
      access_token: tokenJson.access_token,
      refresh_token: tokenJson.refresh_token,
      expires_at: Date.now() + tokenJson.expires_in * 1000,
    });

    return tokenJson.access_token!;
  }
}

// --------------------
// Settings Tab
// --------------------
class GoogleCalendarSettingTab extends PluginSettingTab {
  plugin: GoogleCalendarPlugin;

  constructor(app: App, plugin: GoogleCalendarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setHeading().setName("Google calendar config");

    new Setting(containerEl)
      .setName("Client ID")
      .setDesc("Google OAUTH client ID")
      .addText((text) =>
        text
          .setPlaceholder("Client ID")
          .setValue(this.plugin.settings.clientId)
          .onChange(async (value) => {
            this.plugin.settings.clientId = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Client secret")
      .setDesc("Google OAUTH client secret")
      .addText((text) =>
        text
          .setPlaceholder("Client secret")
          .setValue(this.plugin.settings.clientSecret)
          .onChange(async (value) => {
            this.plugin.settings.clientSecret = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Redirect uri")
      .setDesc("Redirect uri for OAUTH")
      .addText((text) =>
        text
          .setPlaceholder("Redirect uri")
          .setValue(this.plugin.settings.redirectUri)
          .onChange(async (value) => {
            this.plugin.settings.redirectUri = value.trim();
            await this.plugin.saveSettings();
          })
      );
  }
}

// --------------------
// Auth Code Modal
// --------------------
class AuthCodeModal extends Modal {
  static resolver?: (code: string) => void;

  constructor(app: App) {
    super(app);
  }

  static waitForCode(): Promise<string> {
    return new Promise((resolve) => {
      AuthCodeModal.resolver = resolve;
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Google OAUTH code" });

    const input = contentEl.createEl("input");
    input.type = "text";
    input.placeholder = "Paste authorization code here";

    const submit = contentEl.createEl("button", { text: "Submit" });
    submit.onclick = () => {
      if (input.value.trim()) {
        AuthCodeModal.resolver?.(input.value.trim());
        this.close();
      }
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
