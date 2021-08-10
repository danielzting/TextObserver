# TextObserver

![npm](https://img.shields.io/npm/dt/textobserver)
![GitHub release (latest by date)](https://img.shields.io/github/v/release/DanielZTing/TextObserver)
![GitHub code size in bytes](https://img.shields.io/github/languages/code-size/DanielZTing/TextObserver)

`TextObserver` replaces text on a webpage with whatever you want.

```javascript
const observer = new TextObserver(text => text.replaceAll(/heck/gi, 'h*ck'));
```

Similar to [`findAndReplaceDOMText`](https://github.com/padolsey/findAndReplaceDOMText), but with a different use case. Use `findAndReplaceDOMText` if you need to robustly substitute or wrap text that may span across multiple nodes a set number of times. `TextObserver` uses the [`MutationObserver`](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver) interface to keep track of changes in the DOM. Any dynamically updated content will automatically be processed in time linear to the amount of changes, not to the total amount of nodes. This enables usage on modern infinite-scrolling websites that make heavy use of AJAX like Reddit and Discord without performance degrading as more content is added.

## Installation

Download the [latest release](https://github.com/DanielZTing/algorithm-simulator/releases/latest/) and include `TextObserver.js` as a script. If you want to try it out, just paste the file's code into the browser console. It is also available as an [NPM package](https://www.npmjs.com/package/textobserver).


## Usage

### Constructor

`TextObserver(callback, target = document.body, processExisting = true)`

- *`callback`*: a function that takes a string as its only argument and returns a string to replace it with
- *`target` (optional)*: the subtree of the DOM to watch
- *`processExisting` (optional)*: whether to do an initial scan over the existing content

### Methods

`disconnect(flush = true)`

- *`flush` (optional)*: whether to do a "clean-up" run of changes that have been detected but not yet processed by the observer's callback

`reconnect(reprocess = true)`

- *`reprocess` (optional)*: whether to do a complete "re-sweep" of the page; if `false`, changes made while the observer was disconnected are ignored

## Examples

A more advanced regex that uses capturing groups/backreferences to convert miles to kilometers:

```javascript
const observer = new TextObserver(text => text.replaceAll(
    /(\d+\.?\d*) ?mi(\W|les?|$)/gi,
    (match, number) => (parseFloat(number) * 1.609).toFixed(2) + ' km'
));
```

If you want to perform multiple replacements to, say, correct people's grammar or make some [funny substitutions](https://xkcd.com/1288/), extend the callback instead of creating a separate observer for each replacement.

```javascript
const observer = new TextObserver(text => text.replaceAll(
    /would of/gi, 'would have').replaceAll(
    /should of/gi, 'should have'
));
```

The callback is not limited to a regular expression. Here's a more complex example that transforms everything into "mOcKiNg SpOnGeBoB" case. Useful for heated Internet discussions!

```javascript
const observer = new TextObserver(text => {
    let characters = Array.from(text);
    for (let i = 0; i < characters.length; i++) {
        if (Math.random() < 0.5) {
            if (characters[i].toUpperCase() === characters[i]) {
                characters[i] = characters[i].toLowerCase();
            } else {
                characters[i] = characters[i].toUpperCase();
            }
        }
    }
    return characters.join('');
});
```

You don't even have to necessarily modify the text at all if you're doing something like sentiment analysis on your Internet readings. Just remember to return at the end of your callback, or else every string on the page will get blanked out.

## FAQ

### Does `TextObserver` really see *everything*?
Pretty much, I wrote `TextObserver` because the simpler solutions were still missing out some elements. `TextObserver` not only works on plain old text nodes but also CSS generated content with pseudo-elements and HTML attributes that get rendered as text like `alt` text for images and tooltips with `title`, while ignoring elements that would break if touched such as `contentEditable` inputs. Refer to the known issues section for a list of exceptions.

### What about performance?
There are two main pieces to `TextObserver`. One is the "observation" part, that is, the code that watches for added nodes or changes to existing text content and processes them. This step happens in time linear to the number of mutations and should use negligible resources.

The other piece is the scanning of the entire target subtree that occurs whenever the constructor or `reconnect()` are called with their default arguments. This runs in time linear to the total amount of nodes in the target subtree and can take >100ms for the heaviest pages, fast enough to not perceptibly affect load time but enough that whole page scans should only be run a single time during initial load.

To keep things smooth, prefer longer callbacks instead of multiple observers, narrow down the target as much as possible, and call the constructor and `reconnect()` sparingly.

## Known Issues

`TextObserver` should work out of the box 98% of the time. Unfortunately, the modern web is an extraordinarily complex beast, and the following edge cases (hopefully rare for most users) exist.

### Doesn't see `<iframe>`s

An observer created on a page cannot see inside an `<iframe>` from another domain. This security mechanism is enforced by the browser and called the [same origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy). However, if you are using this as part of a browser extension's content script, you can set `"all_frames": true` under the manifest's [`content_scripts`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts) key.

### Misses closed Shadow DOMs

A closed shadow DOM is inaccessible to outside JavaScript. If you're making an extension, you could try [overriding `Element.prototype.attachShadow`](https://stackoverflow.com/q/54954383/16458492) before any other scripts run (if you manage to get this to work, let me know and I'll put up example code).