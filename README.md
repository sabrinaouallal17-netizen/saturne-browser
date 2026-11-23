# Saturne Browser

A custom web browser built with Electron (school project).

## Run

```
npm install
npm start
```

## Features

- **Spaces** – separate groups of tabs. Click the space name to switch, rename or recolor it, use the `+` button (bottom-left) to create one, or press `Ctrl+1…9`.
- **Tabs & folders** – drag tabs to reorder them, drop them on a folder to group them, or on a favorite card to pin them.
- **Auto-unloading** – tabs you haven't used for 10 minutes are unloaded to save memory and turn **gray** in the sidebar. The delay can be changed in *Menu → Settings*.
- **Hover preview** – hover over a tab for 3 seconds to see a small preview (a black screen if the tab is unloaded).
- **Customizable home page** – wallpaper (presets, upload, URL, solid color, blur, dim), all interface colors/grays, and draggable/resizable widgets: Clock, Weather, Search, Recently visited, Quick note, Greeting.
- **Custom UI components** – overlay scrollbars, dropdown/context menus with submenus and keyboard navigation, inputs with autocomplete, selects, switches, sliders.
- Bookmarks bar, favorites, downloads panel, history (`Ctrl+H`), page context menu, zoom, dev tools.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+T / Ctrl+W | New tab / close tab |
| Ctrl+Shift+T | Reopen closed tab |
| Ctrl+L | Focus the address bar |
| Ctrl+R / F5 | Reload |
| Ctrl+D | Bookmark page |
| Ctrl+H | History |
| Ctrl+Shift+S | Toggle sidebar |
| Ctrl+Tab | Next tab |
| Ctrl+1…9 | Switch space |
| Alt+← / Alt+→ | Back / forward |
| Ctrl+= / Ctrl+- / Ctrl+0 | Zoom |
| F12 | Developer tools |

## Project structure

```
main.js            Electron main process (window, downloads, permissions, persistence)
preload.js         Secure bridge between the UI and the main process
src/index.html     Browser UI
src/styles.css     All styles (Figma measurements)
src/js/icons.js    SVG icons
src/js/components.js  Reusable components (scrollbar, menus, inputs, modals…)
src/js/store.js    Saved state (spaces, tabs, settings, history)
src/js/home.js     Home page and widgets
src/js/browser.js  Tabs, spaces, unloading, previews, menus, shortcuts
```

> Note: if `npm install` leaves Electron incomplete ("Electron failed to install correctly"),
> extract the zip from `%LOCALAPPDATA%\electron\Cache\…` into `node_modules/electron/dist`
> and create `node_modules/electron/path.txt` containing `electron.exe`.
