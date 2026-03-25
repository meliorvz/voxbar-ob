import { App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants as fsConstants } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type InputMode = "smart" | "selection" | "note" | "source-url";
type PreparedInput =
  | { kind: "url"; value: string; title: string; disableMetadataTitle: boolean; summary: string }
  | { kind: "text"; value: string; title: string; disableMetadataTitle: boolean; summary: string };

interface VoxBarObSettings {
  voxBarRoot: string;
  voxBarAppPath: string;
  useFrontmatterSourceUrl: boolean;
  frontmatterUrlKeys: string;
  disableMetadataTitlesForText: boolean;
  disableMetadataTitlesForUrls: boolean;
  showProgressNotices: boolean;
}

const DEFAULT_VOXBAR_ROOT = path.join(os.homedir(), "Documents", "VoxBar");

const DEFAULT_SETTINGS: VoxBarObSettings = {
  voxBarRoot: DEFAULT_VOXBAR_ROOT,
  voxBarAppPath: path.join(DEFAULT_VOXBAR_ROOT, "ui", "dist", "VoxBar.app"),
  useFrontmatterSourceUrl: true,
  frontmatterUrlKeys: "source,url,canonical_url,source_url,link",
  disableMetadataTitlesForText: true,
  disableMetadataTitlesForUrls: false,
  showProgressNotices: true,
};

interface VoxBarIncomingPayload {
  input: string;
  title: string;
  disable_metadata_title: boolean;
  auto_generate: boolean;
  origin: string;
  source_kind: "url" | "text";
  created_at: string;
}

export default class VoxBarObPlugin extends Plugin {
  settings: VoxBarObSettings = DEFAULT_SETTINGS;
  private statusBar: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.statusBar = this.addStatusBarItem();
    this.setStatus("Idle");

    this.addRibbonIcon("headphones", "Read with VoxBar", () => {
      void this.run("smart");
    });

    this.addCommand({
      id: "read-selection-or-note",
      name: "Read selection or note with VoxBar",
      callback: () => void this.run("smart"),
    });

    this.addCommand({
      id: "read-selection",
      name: "Read selected text with VoxBar",
      editorCallback: () => void this.run("selection"),
    });

    this.addCommand({
      id: "read-current-note",
      name: "Read current note with VoxBar",
      callback: () => void this.run("note"),
    });

    this.addCommand({
      id: "read-source-url",
      name: "Read source URL from frontmatter with VoxBar",
      callback: () => void this.run("source-url"),
    });

    this.addCommand({
      id: "open-voxbar",
      name: "Open VoxBar",
      callback: () => void this.openVoxBarApp(),
    });

    this.addSettingTab(new VoxBarObSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(loaded ?? {}),
    };
    if (!this.settings.voxBarAppPath) {
      this.settings.voxBarAppPath = path.join(this.settings.voxBarRoot, "ui", "dist", "VoxBar.app");
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.setStatus("Idle");
  }

  private setStatus(text: string): void {
    this.statusBar?.setText(`VoxBar: ${text}`);
  }

  private async run(mode: InputMode): Promise<void> {
    const appPath = this.settings.voxBarAppPath.trim();
    if (!appPath || !this.exists(appPath)) {
      new Notice("Set the VoxBar app path in plugin settings.");
      return;
    }

    const prepared = await this.prepareInput(mode);
    if (!prepared) {
      return;
    }

    try {
      await this.writeIncomingRequest(prepared);
      await this.openVoxBarApp();
      this.setStatus(prepared.summary);
      this.notify(`Sent to VoxBar: ${prepared.summary}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus("Handoff failed");
      this.notify(`VoxBar handoff failed: ${message}`, true);
    }
  }

  private async prepareInput(mode: InputMode): Promise<PreparedInput | null> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!view || !file) {
      new Notice("Open a markdown note first.");
      return null;
    }

    const selection = view.editor?.getSelection()?.trim() ?? "";
    const noteTitle = file.basename;

    if (mode === "selection") {
      if (!selection) {
        new Notice("Select text first.");
        return null;
      }
      return this.selectionToInput(selection, noteTitle);
    }

    if (mode === "source-url") {
      const sourceUrl = this.frontmatterSourceUrl(file);
      if (!sourceUrl) {
        new Notice("No supported source URL found in frontmatter.");
        return null;
      }
      return {
        kind: "url",
        value: sourceUrl,
        title: noteTitle,
        disableMetadataTitle: this.settings.disableMetadataTitlesForUrls,
        summary: "Reading source URL from frontmatter",
      };
    }

    if (mode === "smart" && selection) {
      return this.selectionToInput(selection, noteTitle);
    }

    if (mode === "smart" && this.settings.useFrontmatterSourceUrl) {
      const sourceUrl = this.frontmatterSourceUrl(file);
      if (sourceUrl) {
        return {
          kind: "url",
          value: sourceUrl,
          title: noteTitle,
          disableMetadataTitle: this.settings.disableMetadataTitlesForUrls,
          summary: "Reading source URL from frontmatter",
        };
      }
    }

    const raw = await this.app.vault.cachedRead(file);
    const cleaned = this.cleanObsidianMarkdown(raw);
    if (!cleaned.trim()) {
      new Notice("The note is empty after cleaning frontmatter and markup.");
      return null;
    }

    return {
      kind: "text",
      value: cleaned,
      title: noteTitle,
      disableMetadataTitle: this.settings.disableMetadataTitlesForText,
      summary: "Reading current note",
    };
  }

  private selectionToInput(selection: string, noteTitle: string): PreparedInput {
    const trimmed = selection.trim();
    if (this.looksLikeUrl(trimmed)) {
      return {
        kind: "url",
        value: trimmed,
        title: noteTitle,
        disableMetadataTitle: this.settings.disableMetadataTitlesForUrls,
        summary: "Reading selected URL",
      };
    }

    return {
      kind: "text",
      value: this.cleanObsidianMarkdown(trimmed),
      title: noteTitle,
      disableMetadataTitle: this.settings.disableMetadataTitlesForText,
      summary: "Reading selected text",
    };
  }

  private frontmatterSourceUrl(file: TFile): string | null {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter) {
      return null;
    }

    const keys = this.settings.frontmatterUrlKeys
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    for (const key of keys) {
      const value = frontmatter[key];
      if (typeof value === "string" && this.looksLikeUrl(value.trim())) {
        return value.trim();
      }
    }

    return null;
  }

  private cleanObsidianMarkdown(text: string): string {
    let cleaned = text.replace(/\r\n/g, "\n");
    cleaned = cleaned.replace(/^---\n[\s\S]*?\n---\n*/u, "");
    cleaned = cleaned.replace(/%%[\s\S]*?%%/gu, "");
    cleaned = cleaned.replace(/^> \[![^\]]+\][^\n]*$/gmu, "");
    cleaned = cleaned.replace(/^>\s?/gmu, "");
    cleaned = cleaned.replace(/!\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/gu, (_match, target, alias) => alias ?? this.lastPathSegment(target));
    cleaned = cleaned.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/gu, (_match, target, alias) => alias ?? this.lastPathSegment(target));
    cleaned = cleaned.replace(/\^[-A-Za-z0-9]+$/gmu, "");
    cleaned = cleaned.replace(/`{3}[\s\S]*?`{3}/gu, "");
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
    return cleaned.trim();
  }

  private lastPathSegment(value: string): string {
    const normalized = value.replace(/\\/g, "/");
    const last = normalized.split("/").pop() ?? normalized;
    return last.replace(/[-_]+/g, " ").trim();
  }

  private async writeIncomingRequest(input: PreparedInput): Promise<string> {
    const inboxRoot = path.join(os.homedir(), "Library", "Application Support", "VoxBar", "Inbox");
    await mkdir(inboxRoot, { recursive: true });

    const payload: VoxBarIncomingPayload = {
      input: input.value,
      title: input.title,
      disable_metadata_title: input.disableMetadataTitle,
      auto_generate: true,
      origin: "obsidian",
      source_kind: input.kind,
      created_at: new Date().toISOString(),
    };

    const filePath = path.join(inboxRoot, `${randomUUID()}.json`);
    await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
    return filePath;
  }

  private async openVoxBarApp(): Promise<void> {
    const appPath = this.settings.voxBarAppPath.trim();
    await this.runOpen(["-a", appPath]);
  }

  private async runOpen(args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("/usr/bin/open", args, {
        stdio: "ignore",
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`/usr/bin/open exited with code ${code}`));
        }
      });
    });
  }

  private exists(filePath: string): boolean {
    try {
      accessSync(filePath, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private looksLikeUrl(value: string): boolean {
    return /^https?:\/\/\S+$/i.test(value);
  }

  private notify(message: string, isError = false): void {
    if (!this.settings.showProgressNotices && !isError) {
      return;
    }
    new Notice(message, isError ? 7000 : 4000);
  }
}

class VoxBarObSettingTab extends PluginSettingTab {
  plugin: VoxBarObPlugin;

  constructor(app: App, plugin: VoxBarObPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "VoxBar for Obsidian" });

    new Setting(containerEl)
      .setName("VoxBar root")
      .setDesc("Root folder for the local VoxBar checkout.")
      .addText((text) =>
        text
          .setPlaceholder("/Users/you/Documents/VoxBar")
          .setValue(this.plugin.settings.voxBarRoot)
          .onChange(async (value) => {
            const trimmed = value.trim();
            this.plugin.settings.voxBarRoot = trimmed;
            if (!this.plugin.settings.voxBarAppPath || this.plugin.settings.voxBarAppPath === DEFAULT_SETTINGS.voxBarAppPath) {
              this.plugin.settings.voxBarAppPath = path.join(trimmed, "ui", "dist", "VoxBar.app");
            }
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("VoxBar app path")
      .setDesc("Path to the local VoxBar.app bundle used for handoff.")
      .addText((text) =>
        text
          .setPlaceholder("/Users/you/Documents/VoxBar/ui/dist/VoxBar.app")
          .setValue(this.plugin.settings.voxBarAppPath)
          .onChange(async (value) => {
            this.plugin.settings.voxBarAppPath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Prefer source URL in frontmatter")
      .setDesc("When no text is selected, use source/url fields from note frontmatter before reading the note body.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useFrontmatterSourceUrl)
          .onChange(async (value) => {
            this.plugin.settings.useFrontmatterSourceUrl = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Frontmatter URL keys")
      .setDesc("Comma-separated frontmatter keys checked for an article URL.")
      .addText((text) =>
        text
          .setPlaceholder("source,url,canonical_url,source_url,link")
          .setValue(this.plugin.settings.frontmatterUrlKeys)
          .onChange(async (value) => {
            this.plugin.settings.frontmatterUrlKeys = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Keep note title for text handoff")
      .setDesc("Disable VoxBar metadata title generation when sending note text so the current note title is preserved.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.disableMetadataTitlesForText)
          .onChange(async (value) => {
            this.plugin.settings.disableMetadataTitlesForText = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Keep note title for URL handoff")
      .setDesc("Disable VoxBar metadata title generation for URLs too. Turn this off if you prefer article-derived titles inside VoxBar.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.disableMetadataTitlesForUrls)
          .onChange(async (value) => {
            this.plugin.settings.disableMetadataTitlesForUrls = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show progress notices")
      .setDesc("Show lightweight notices when the note is handed off to VoxBar.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showProgressNotices)
          .onChange(async (value) => {
            this.plugin.settings.showProgressNotices = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
