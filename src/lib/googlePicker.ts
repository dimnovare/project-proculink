/**
 * googlePicker.ts — opens Google's file picker for a folder or a spreadsheet (plan 9b).
 *
 * The `drive.file` scope only lets ProcuLink touch files the user picks here, which is why a Google
 * destination stores a picked id rather than a typed path. `api.js` is loaded once from Google at
 * runtime (CSP script-src allows `https://apis.google.com`; the picker itself is a
 * `https://docs.google.com` frame). The types below are the few members this file calls — no
 * `@types` package.
 */

type PickerDoc = { id: string; name: string };
type PickerData = { action: string; docs?: PickerDoc[] };
interface DocsView { setSelectFolderEnabled(on: boolean): DocsView; setMimeTypes(types: string): DocsView }
interface PickerBuilder {
  addView(view: DocsView): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  setCallback(cb: (data: PickerData) => void): PickerBuilder;
  build(): { setVisible(on: boolean): void };
}
type GoogleGlobals = {
  gapi?: { load(name: string, cb: () => void): void };
  google?: {
    picker: {
      DocsView: new (viewId: string) => DocsView;
      PickerBuilder: new () => PickerBuilder;
      ViewId: { FOLDERS: string; SPREADSHEETS: string };
    };
  };
};

const API_JS = "https://apis.google.com/js/api.js";
const FOLDER_MIME = "application/vnd.google-apps.folder";
let loaded: Promise<NonNullable<GoogleGlobals["google"]>["picker"]> | null = null;

function loadPicker() {
  loaded ??= new Promise((resolve, reject) => {
    const g = window as unknown as GoogleGlobals;
    const script = document.createElement("script");
    script.src = API_JS;
    script.async = true;
    script.onload = () => g.gapi!.load("picker", () => resolve(g.google!.picker));
    script.onerror = () => { loaded = null; reject(new Error("Google's file picker didn't load. Try again.")); };
    document.head.appendChild(script);
  });
  return loaded;
}

/** The picked folder or spreadsheet, or null when the user closed the picker. */
export async function openGooglePicker(opts: {
  kind: "folder" | "spreadsheet"; accessToken: string; apiKey: string; appId: string;
}): Promise<PickerDoc | null> {
  const picker = await loadPicker();
  const view = opts.kind === "folder"
    ? new picker.DocsView(picker.ViewId.FOLDERS).setSelectFolderEnabled(true).setMimeTypes(FOLDER_MIME)
    : new picker.DocsView(picker.ViewId.SPREADSHEETS);
  return new Promise((resolve) => {
    new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(opts.accessToken)
      .setDeveloperKey(opts.apiKey)
      .setAppId(opts.appId) // required for drive.file: it grants this app the picked file
      .setCallback((data) => {
        const doc = data.docs?.[0];
        if (data.action === "picked" && doc) resolve({ id: doc.id, name: doc.name });
        else if (data.action === "cancel") resolve(null);
      })
      .build()
      .setVisible(true);
  });
}
