# TextObserver

![npm](https://img.shields.io/npm/dt/textobserver)
![GitHub release (latest by date)](https://img.shields.io/github/v/release/DanielZTing/TextObserver)
![GitHub code size in bytes](https://img.shields.io/github/languages/code-size/DanielZTing/TextObserver)

`TextObserver` replaces text on a webpage with whatever you want.

```javascript
const badWordFilter = new TextObserver(text => text.replaceAll(/heck/gi, 'h*ck'));
```

Inspired by [`findAndReplaceDOMText`](https://github.com/padolsey/findAndReplaceDOMText), but with a different use case. Use `findAndReplaceDOMText` if you need to robustly substitute or wrap text that may span across multiple nodes a set number of times. `TextObserver` uses the [`MutationObserver`](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver) interface to keep track of changes in the DOM. Any dynamically updated content will automatically be processed in time linear to the amount of changes, not to the total amount of nodes. This enables usage on modern infinite-scrolling websites that make heavy use of AJAX like Reddit and Discord without performance degrading as more content is added.

## Installation

All the code is self-contained in `TextObserver.js`. If you just want to try it out, paste the contents of `TextObserver.js` into the browser console. It is also available as an [NPM package](https://www.npmjs.com/package/textobserver).


## Usage

### Constructor

`TextObserver(callback, target = document, processExisting = true, performanceOptions = {...})`

- *`callback`*: a function that takes a string as its only argument and returns a string to replace it with
- *`target` (optional)*: the subtree of the DOM to watch (set to `document.body` if you want to exclude the `<title>`)
- *`processExisting` (optional)*: whether to do an initial scan over the existing content
- *`performanceOptions` (optional)*: a dictionary with keys specifying what to watch; see **Performance** section below

### Methods

`disconnect(flush = true)`

- *`flush` (optional)*: whether to do a "clean-up" run of changes that have been detected but not yet processed by the observer's callback

`reconnect(reprocess = true)`

- *`reprocess` (optional)*: whether to do a complete "re-sweep" of the page; if `false`, changes made while the observer was disconnected are ignored

## Examples

A more advanced regex that uses capturing groups/backreferences to convert miles to kilometers:

```javascript
const unitConverter = new TextObserver(text => text.replaceAll(
    /(\d+\.?\d*) ?mi(\W|les?|$)/gi,
    (match, number) => (parseFloat(number) * 1.609).toFixed(2) + ' km'
));
```

The callback is not limited to a regular expression. Here's a more complex example that transforms everything into "mOcKiNg SpOnGeBoB" case. Useful for heated Internet discussions!

```javascript
const spongebobCase = new TextObserver(text => {
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

## Performance

*Note: All measurements were taken on the front page of New Reddit on a Core i5-8210Y running Chromium 91, roughly equivalent to an iPhone 7 on GeekBench. Your numbers should be better if you're targeting laptops and desktops, while older netbooks and phones may be slower.*

There are two main pieces to `TextObserver`. One is the "observation" part, that is, the code that watches for added nodes or changes to existing text content and processes them. This step happens in time linear to the number of mutations and should use negligible resources.

The other piece is the scanning of the entire target subtree that occurs whenever the constructor or `reconnect()` are called with their default arguments. This runs in time linear to the total amount of nodes in the target subtree and can take >100ms for the heaviest pages, fast enough to not perceptibly affect load time but enough that whole page scans should only be run a single time during initial load. The time it takes to walk through the DOM dominates the time spent in the callback. That is why if you want to perform multiple replacements, it is recommended to extend the callback instead of creating a separate observer for each replacement.

*Baseline: ~100 ms range*

```javascript
const grammarPolice = new TextObserver(text => text.replaceAll(/would of/gi, 'would have'));
```

*Good: performs practically identically to baseline*

```javascript
const grammarPolice = new TextObserver(text => text.replaceAll(
    /would of/gi, 'would have').replaceAll(
    /should of/gi, 'should have'
));
```

*Bad: ~200 ms range*

```javascript
const grammarPolice = new TextObserver(text => text.replaceAll(/would of/gi, 'would have'));
const grammarPolice2 = new TextObserver(text => text.replaceAll(/should of/gi, 'should have'));
```

Narrowing down the target as much as possible and calling the constructor and `reconnect()` sparingly will also greatly help. To further customize performance, you can set the following keys in the constructor's `performanceOptions` dictionary **(any missing keys will be assumed to be off)**:

- *`cssContent` (default `false`)*: Check for text generated with the CSS `content` key. This may cause a style recalculation bottleneck and push execution time to over a second, so it is turned off by default.
- *`iconFonts` (default `false`)*: Skip text whose `font-family` contains the word "icon." This is computationally expensive for the same reason as the above setting and having both enabled can take seconds to process the whole document.
- *`contentEditable` (default `true`)*: Only process text whose parent is **not** `contentEditable`. Disable only if you're sure the page has no `contentEditable` elements because modifying their text messes up the cursor position, resulting in a frustrating user experience. It also doesn't make much sense to disable this or any of the below options when either `cssContent` or `iconFonts` has been enabled because the cost of computing styles is massive compared to everything else.
- *`attributes` (default `true`)*: Process HTML attributes that get rendered by the browser as user-visible text such as image alt text, input placeholders, etc. Disabling this and `contentEditable` can cut runtime to about half that of the default config.
- *`shadows` (default `true`)*: Search for and process open Shadow DOMs as well as override `Element.prototype.attachShadow()` to force Shadow DOMs created in the future to open mode. This option doesn't have a big impact on performance; it mostly exists if you want to respect the encapsulation of Shadow DOMs.

## Known Issues

`TextObserver` should work out of the box 98% of the time. Unfortunately, the modern web is an extraordinarily complex beast, and the following edge cases (hopefully rare for most users) exist.

### Doesn't see `<iframe>`s
An observer created on a page cannot see inside an `<iframe>` from another domain due to the browser-enforced [same origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy). However, if you are using this as part of a web extension's content script, you can set `"all_frames": true` in your [manifest](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts) to tell the browser to inject the script into every frame's execution context.

### Misses closed Shadow DOMs
A closed Shadow DOM is inaccessible to outside JavaScript. If you're making an extension, you could try [injecting the script into the page's execution context](https://stackoverflow.com/q/54954383/16458492) before any other scripts run to force Shadow DOMs to open mode (if you manage to get this to work, let me know and I'll put up example code).

### Repeated "recursive" replacements
If your "before" text is a substring of your "after" text (e.g. replacing ["expands" with "physically expands"](https://xkcd.com/1625/)) you may find that the replacement has happened more than once ("physically physically physically physically [...] expands"). Many modern sites chop and slice the DOM in all kinds of weird ways, and what looks like one mutation is internally interpreted as many by the code. Unfortunately I can only suggest to avoid such "recursive" substitutions.

### Messes with document editors
Complex online code editors and word processors can exhibit quirks if `TextObserver` changes their contents, especially if the replacement is of a different length than the old value ("heck" to "heckerino!" is more likely to cause issues than "heck" to "h*ck"). I would suggest allowing the user to disable replacements on a site-by-site basis if applicable.