"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => VoxBarObPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_node_child_process = require("node:child_process");
var import_node_crypto = require("node:crypto");
var import_node_fs = require("node:fs");
var import_promises = require("node:fs/promises");
var import_node_os = __toESM(require("node:os"));
var import_node_path = __toESM(require("node:path"));
var DEFAULT_VOXBAR_ROOT = import_node_path.default.join(import_node_os.default.homedir(), "Documents", "VoxBar");
var DEFAULT_SETTINGS = {
  voxBarRoot: DEFAULT_VOXBAR_ROOT,
  voxBarAppPath: import_node_path.default.join(DEFAULT_VOXBAR_ROOT, "ui", "dist", "VoxBar.app"),
  useFrontmatterSourceUrl: true,
  frontmatterUrlKeys: "source,url,canonical_url,source_url,link",
  disableMetadataTitlesForText: true,
  disableMetadataTitlesForUrls: false,
  showProgressNotices: true
};
var VoxBarObPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.statusBar = null;
  }
  async onload() {
    await this.loadSettings();
    this.statusBar = this.addStatusBarItem();
    this.setStatus("Idle");
    this.addRibbonIcon("headphones", "Read with VoxBar", () => {
      void this.run("smart");
    });
    this.addCommand({
      id: "read-selection-or-note",
      name: "Read selection or note with VoxBar",
      callback: () => void this.run("smart")
    });
    this.addCommand({
      id: "read-selection",
      name: "Read selected text with VoxBar",
      editorCallback: () => void this.run("selection")
    });
    this.addCommand({
      id: "read-current-note",
      name: "Read current note with VoxBar",
      callback: () => void this.run("note")
    });
    this.addCommand({
      id: "read-source-url",
      name: "Read source URL from frontmatter with VoxBar",
      callback: () => void this.run("source-url")
    });
    this.addCommand({
      id: "open-voxbar",
      name: "Open VoxBar",
      callback: () => void this.openVoxBarApp()
    });
    this.addSettingTab(new VoxBarObSettingTab(this.app, this));
  }
  async loadSettings() {
    const loaded = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded ?? {}
    };
    if (!this.settings.voxBarAppPath) {
      this.settings.voxBarAppPath = import_node_path.default.join(this.settings.voxBarRoot, "ui", "dist", "VoxBar.app");
    }
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.setStatus("Idle");
  }
  setStatus(text) {
    this.statusBar?.setText(`VoxBar: ${text}`);
  }
  async run(mode) {
    const appPath = this.settings.voxBarAppPath.trim();
    if (!appPath || !this.exists(appPath)) {
      new import_obsidian.Notice("Set the VoxBar app path in plugin settings.");
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
  async prepareInput(mode) {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
    const file = view?.file;
    if (!view || !file) {
      new import_obsidian.Notice("Open a markdown note first.");
      return null;
    }
    const selection = view.editor?.getSelection()?.trim() ?? "";
    const noteTitle = file.basename;
    if (mode === "selection") {
      if (!selection) {
        new import_obsidian.Notice("Select text first.");
        return null;
      }
      return this.selectionToInput(selection, noteTitle);
    }
    if (mode === "source-url") {
      const sourceUrl = this.frontmatterSourceUrl(file);
      if (!sourceUrl) {
        new import_obsidian.Notice("No supported source URL found in frontmatter.");
        return null;
      }
      return {
        kind: "url",
        value: sourceUrl,
        title: noteTitle,
        disableMetadataTitle: this.settings.disableMetadataTitlesForUrls,
        summary: "Reading source URL from frontmatter"
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
          summary: "Reading source URL from frontmatter"
        };
      }
    }
    const raw = await this.app.vault.cachedRead(file);
    const cleaned = this.cleanObsidianMarkdown(raw);
    if (!cleaned.trim()) {
      new import_obsidian.Notice("The note is empty after cleaning frontmatter and markup.");
      return null;
    }
    return {
      kind: "text",
      value: cleaned,
      title: noteTitle,
      disableMetadataTitle: this.settings.disableMetadataTitlesForText,
      summary: "Reading current note"
    };
  }
  selectionToInput(selection, noteTitle) {
    const trimmed = selection.trim();
    if (this.looksLikeUrl(trimmed)) {
      return {
        kind: "url",
        value: trimmed,
        title: noteTitle,
        disableMetadataTitle: this.settings.disableMetadataTitlesForUrls,
        summary: "Reading selected URL"
      };
    }
    return {
      kind: "text",
      value: this.cleanObsidianMarkdown(trimmed),
      title: noteTitle,
      disableMetadataTitle: this.settings.disableMetadataTitlesForText,
      summary: "Reading selected text"
    };
  }
  frontmatterSourceUrl(file) {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter) {
      return null;
    }
    const keys = this.settings.frontmatterUrlKeys.split(",").map((value) => value.trim()).filter(Boolean);
    for (const key of keys) {
      const value = frontmatter[key];
      if (typeof value === "string" && this.looksLikeUrl(value.trim())) {
        return value.trim();
      }
    }
    return null;
  }
  cleanObsidianMarkdown(text) {
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
  lastPathSegment(value) {
    const normalized = value.replace(/\\/g, "/");
    const last = normalized.split("/").pop() ?? normalized;
    return last.replace(/[-_]+/g, " ").trim();
  }
  async writeIncomingRequest(input) {
    const inboxRoot = import_node_path.default.join(import_node_os.default.homedir(), "Library", "Application Support", "VoxBar", "Inbox");
    await (0, import_promises.mkdir)(inboxRoot, { recursive: true });
    const payload = {
      input: input.value,
      title: input.title,
      disable_metadata_title: input.disableMetadataTitle,
      auto_generate: true,
      origin: "obsidian",
      source_kind: input.kind,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    const filePath = import_node_path.default.join(inboxRoot, `${(0, import_node_crypto.randomUUID)()}.json`);
    await (0, import_promises.writeFile)(filePath, JSON.stringify(payload, null, 2), "utf8");
    return filePath;
  }
  async openVoxBarApp() {
    const appPath = this.settings.voxBarAppPath.trim();
    await this.runOpen(["-a", appPath]);
  }
  async runOpen(args) {
    await new Promise((resolve, reject) => {
      const child = (0, import_node_child_process.spawn)("/usr/bin/open", args, {
        stdio: "ignore"
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
  exists(filePath) {
    try {
      (0, import_node_fs.accessSync)(filePath, import_node_fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
  looksLikeUrl(value) {
    return /^https?:\/\/\S+$/i.test(value);
  }
  notify(message, isError = false) {
    if (!this.settings.showProgressNotices && !isError) {
      return;
    }
    new import_obsidian.Notice(message, isError ? 7e3 : 4e3);
  }
};
var VoxBarObSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "VoxBar for Obsidian" });
    new import_obsidian.Setting(containerEl).setName("VoxBar root").setDesc("Root folder for the local VoxBar checkout.").addText(
      (text) => text.setPlaceholder("/Users/you/Documents/VoxBar").setValue(this.plugin.settings.voxBarRoot).onChange(async (value) => {
        const trimmed = value.trim();
        this.plugin.settings.voxBarRoot = trimmed;
        if (!this.plugin.settings.voxBarAppPath || this.plugin.settings.voxBarAppPath === DEFAULT_SETTINGS.voxBarAppPath) {
          this.plugin.settings.voxBarAppPath = import_node_path.default.join(trimmed, "ui", "dist", "VoxBar.app");
        }
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("VoxBar app path").setDesc("Path to the local VoxBar.app bundle used for handoff.").addText(
      (text) => text.setPlaceholder("/Users/you/Documents/VoxBar/ui/dist/VoxBar.app").setValue(this.plugin.settings.voxBarAppPath).onChange(async (value) => {
        this.plugin.settings.voxBarAppPath = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Prefer source URL in frontmatter").setDesc("When no text is selected, use source/url fields from note frontmatter before reading the note body.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.useFrontmatterSourceUrl).onChange(async (value) => {
        this.plugin.settings.useFrontmatterSourceUrl = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Frontmatter URL keys").setDesc("Comma-separated frontmatter keys checked for an article URL.").addText(
      (text) => text.setPlaceholder("source,url,canonical_url,source_url,link").setValue(this.plugin.settings.frontmatterUrlKeys).onChange(async (value) => {
        this.plugin.settings.frontmatterUrlKeys = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Keep note title for text handoff").setDesc("Disable VoxBar metadata title generation when sending note text so the current note title is preserved.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.disableMetadataTitlesForText).onChange(async (value) => {
        this.plugin.settings.disableMetadataTitlesForText = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Keep note title for URL handoff").setDesc("Disable VoxBar metadata title generation for URLs too. Turn this off if you prefer article-derived titles inside VoxBar.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.disableMetadataTitlesForUrls).onChange(async (value) => {
        this.plugin.settings.disableMetadataTitlesForUrls = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Show progress notices").setDesc("Show lightweight notices when the note is handed off to VoxBar.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.showProgressNotices).onChange(async (value) => {
        this.plugin.settings.showProgressNotices = value;
        await this.plugin.saveSettings();
      })
    );
  }
};
