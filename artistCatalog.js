// NAME: All Songs by Artist
// DESCRIPTION: Add an artist's complete available catalog using Spotify's own playlist menu.
// VERSION: 1.0.2
// LICENSE: MIT
(() => {
  "use strict";
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function main() {
    while (!window.Spicetify?.ContextMenuV2 || !Spicetify.ReactComponent?.MenuItem || !Spicetify.ReactComponent?.MenuSubMenuItem || !Spicetify.GraphQL?.Request || !Spicetify.LocalStorage) await pause(300);
    const S = Spicetify;
    const R = S.React;
    const h = R.createElement;
    const chunks = window.rspackChunk || window.rspackChunkclient_web || window.webpackChunkclient_web;
    if (!chunks) return S.showNotification("All Songs by Artist: Spotify's module loader is unavailable.", true);
    const require = chunks.push([[Symbol("artist-catalog")], {}, loader => loader]);
    let artistChunk;

    async function definition(name) {
      if (S.GraphQL.Definitions[name]) return S.GraphQL.Definitions[name];
      const loadDefinition = () => {
        const match = Object.entries(require.m).find(([, factory]) => factory.toString().includes(`Definitions["${name}"]`));
        if (match) require(match[0]);
        return S.GraphQL.Definitions[name];
      };
      let result = loadDefinition();
      if (!result && name.startsWith("queryArtist")) {
        artistChunk ??= new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = new URL("/xpui-routes-artist.js", location.origin).href;
          script.onload = resolve;
          script.onerror = () => reject(new Error("Could not load Spotify's artist catalog module."));
          document.head.append(script);
        });
        await artistChunk;
        result = loadDefinition();
      }
      if (!result) throw new Error(`Spotify no longer exposes ${name}. Update All Songs by Artist.`);
      return result;
    }

    async function query(name, variables) {
      const result = await S.GraphQL.Request(await definition(name), variables);
      if (result?.errors?.length || !result?.data) throw new Error(result?.errors?.[0]?.message || "Spotify returned no catalog data.");
      return result.data;
    }

    function nativePlaylistMenu() {
      // Discover the native component by behavior, never by a build-specific module ID.
      const matches = Object.entries(require.m).filter(([, factory]) => {
        const source = factory.toString();
        return source.includes('focusTransferKey:"ADD_TO_PLAYLIST_SUBMENU"') && source.includes("contextmenu.add-to-playlist");
      });
      if (matches.length !== 1) throw new Error("Spotify's native playlist menu changed. Update All Songs by Artist.");
      const exports = Object.values(require(matches[0][0]));
      if (exports.length !== 1 || typeof exports[0] !== "function") throw new Error("Spotify's playlist menu is unavailable.");
      return exports[0];
    }

    async function collect(artistUri, progress, includeAppearances, signal) {
      const check = () => { if (signal.aborted) throw new DOMException("Cancelled", "AbortError"); };
      const albums = new Map();
      const addRelease = release => {
        if (/^spotify:album:[A-Za-z0-9]+$/.test(release?.uri) && release.playability?.playable !== false) albums.set(release.uri, release);
      };
      for (let offset = 0; ; ) {
        check();
        progress("Reading releases…");
        const data = await query("queryArtistDiscographyAll", { uri: artistUri, offset, limit: 50, order: "DATE_ASC" });
        const page = data.artistUnion?.discography?.all;
        if (!Array.isArray(page?.items) || !Number.isInteger(page.totalCount)) throw new Error("Unexpected artist catalog response.");
        for (const group of page.items) for (const release of group.releases?.items || []) addRelease(release);
        offset += page.items.length;
        if (offset >= page.totalCount) break;
        if (!page.items.length) throw new Error("Spotify stopped returning releases before the catalog was complete.");
      }
      if (includeAppearances) {
        check();
        progress("Reading appearances…");
        const data = await query("queryArtistAppearsOn", { uri: artistUri });
        const page = data.artistUnion?.relatedContent?.appearsOn;
        if (!Array.isArray(page?.items)) throw new Error("Unexpected artist appearances response.");
        for (const group of page.items) {
          if (group.releases?.items) group.releases.items.forEach(addRelease);
          else addRelease(group);
        }
        if (page.totalCount > page.items.length) throw new Error("Spotify returned an incomplete appearances list. Try without appearances.");
      }
      const tracks = new Set();
      let done = 0;
      for (const album of albums.values()) {
        for (let offset = 0; ; ) {
          check();
          progress(`Reading release ${done + 1} of ${albums.size}…`);
          const data = await query("getAlbum", { uri: album.uri, locale: S.Locale?.getLocale?.() || "en", offset, limit: 50 });
          const page = data.albumUnion?.tracksV2;
          if (!Array.isArray(page?.items) || !Number.isInteger(page.totalCount)) throw new Error(`Could not read ${album.name || "an album"}.`);
          for (const { track } of page.items) {
            if (track?.playability?.playable !== false && /^spotify:track:[A-Za-z0-9]+$/.test(track?.uri) && track.artists?.items?.some(artist => artist.uri === artistUri)) tracks.add(track.uri);
          }
          offset += page.items.length;
          if (offset >= page.totalCount) break;
          if (!page.items.length) throw new Error("Spotify stopped returning tracks before the album was complete.");
        }
        done++;
        await pause(80);
      }
      check();
      if (!tracks.size) throw new Error("No playable tracks were found for this artist.");
      if (tracks.size > 10000) throw new Error("This catalog exceeds Spotify's 10,000-track playlist limit.");
      return [...tracks];
    }

    const jobs = new Map();
    const cache = new Map();
    const appearanceSetting = "artist-catalog:include-appearances";
    function CatalogMenu({ artistUri }) {
      const [state, setState] = R.useState({ kind: "idle" });
      const [appearances, setAppearances] = R.useState(() => S.LocalStorage.get(appearanceSetting) !== "false");
      const controller = R.useRef(null);
      R.useEffect(() => () => controller.current?.abort(), []);
      async function load(event) {
        event?.preventDefault();
        event?.stopPropagation();
        if (jobs.has(artistUri)) return;
        const abort = new AbortController();
        controller.current = abort;
        jobs.set(artistUri, abort);
        setState({ kind: "loading", message: "Reading releases…" });
        try {
          const Menu = nativePlaylistMenu();
          const cacheKey = `${artistUri}:${appearances}`;
          const cached = cache.get(cacheKey);
          const uris = cached && Date.now() - cached.time < 300000 ? cached.uris : await collect(artistUri, message => {
            if (!abort.signal.aborted) setState({ kind: "loading", message });
          }, appearances, abort.signal);
          if (abort.signal.aborted) return;
          cache.set(cacheKey, { time: Date.now(), uris });
          setState({ kind: "ready", uris, Menu });
        } catch (error) {
          if (error.name !== "AbortError") {
            setState({ kind: "error", message: error.message });
            S.showNotification(`All Songs by Artist: ${error.message}`, true);
          }
        } finally {
          jobs.delete(artistUri);
        }
      }
      const item = (key, text, props = {}) => h(S.ReactComponent.MenuItem, { key, role: "menuitem", autoClose: false, ...props }, text);
      function toggleAppearances() {
        const next = !appearances;
        controller.current?.abort();
        S.LocalStorage.set(appearanceSetting, String(next));
        setAppearances(next);
        setState({ kind: "idle" });
      }
      const toggle = item("appearances", "Include guest appearances", {
        role: "menuitemcheckbox",
        "aria-checked": appearances,
        disabled: state.kind === "loading",
        onClick: toggleAppearances,
      });
      let action;
      let picker = null;
      if (state.kind === "ready") {
        action = [item("collect", `${state.uris.length.toLocaleString()} artist tracks ready`, { disabled: true }), toggle];
        picker = h(state.Menu, { key: "native-playlist-menu", uris: state.uris });
      } else if (state.kind === "loading") {
        action = [item("collect", state.message, { disabled: true }), toggle];
      } else {
        action = [
          item("collect", state.kind === "error" ? "Retry collecting artist tracks" : "Collect all artist tracks", { onClick: load }),
          toggle,
        ];
      }
      // Spotify's playlist component owns depth 1. Keep it in the root menu so
      // its pointer corridor, keyboard navigation and folder depths stay native.
      return h(R.Fragment, null,
        h(S.ReactComponent.MenuSubMenuItem, {
          key: "artist-catalog-options",
          displayText: "Make all of artist",
          depth: 1,
          placement: "right-start",
          onOpenChange: () => {},
          onClick: () => {},
        }, action),
        picker,
      );
    }

    const registration = {
      _render({ props }) {
        const uris = S.ContextMenuV2.parseProps(props)?.[0];
        return h(CatalogMenu, { key: `artist-catalog-${uris[0]}`, artistUri: uris[0] });
      },
    };
    S.ContextMenuV2.registerItem(registration, props => {
      const uris = S.ContextMenuV2.parseProps(props)?.[0];
      return uris?.length === 1 && /^spotify:artist:[A-Za-z0-9]+$/.test(uris[0]);
    });
  }
  main().catch(error => {
    console.error("[All Songs by Artist] Initialization failed", error);
    window.Spicetify?.showNotification("All Songs by Artist could not initialize. See the developer console.", true);
  });
})();
