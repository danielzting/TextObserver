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

Download the [latest release](https://github.com/DanielZTing/algorithm-simulator/releases/latest/) and include `TextObserver.js` as a `<script>` on your page. If you want to try it out, just paste the file's code into the browser console. It is also available as an [NPM package](https://www.npmjs.com/package/textobserver).


## Usage

### Constructor

`TextObserver(callback, target = document.body)`

- *`callback`*: a function that takes a string as its only argument and returns a string to replace it with
- *`target` (optional)*: the subtree of the DOM to watch

### Methods

`disconnect(flush = true)`

- *`flush` (optional)*: whether to do a "clean-up" run of changes that have been detected but not yet processed by the observer's callback

`reconnect(rerun = true)`

- *`rerun` (optional)*: whether to do a complete "re-sweep" of the page; if `false`, changes made while the observer was disconnected are ignored

## Examples

A more advanced regex that uses capturing groups/backreferences to convert miles to kilometers:

```javascript
const observer = new TextObserver(text => text.replaceAll(
    /(\d+\.?\d*) ?mi(\W|les?|$)/gi,
    (match, number) => (parseFloat(number) * 1.609).toFixed(2) + ' km'
));
```

If you want to perform multiple replacements to, say, correct people's grammar or make some [funny substitutions](https://xkcd.com/1288/), extend the callback instead of creating a separate observer for each replacement. Observers with overlapping target subtrees may "ping-pong" each other back and forth infinitely as a change in one observer's callback alerts other observers and triggers their callbacks.

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

You don't even have to necessarily modify the text at all if you're doing something like sentiment analysis on your Internet readings. Just remember to return at the end of your callback.
