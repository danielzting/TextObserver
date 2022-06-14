export default class TextObserver {
    // MutationObserver cannot detect Shadow DOMs so we must manually keep track of every shadow root and observe them
    #targets = new Set();
    #callback;
    #observer;
    #performanceOptions;
    // Sometimes, MutationRecords of type 'childList' have added nodes with overlapping subtrees
    // Nodes can also be removed and reattached from one parent to another
    // This can cause resource usage to explode with "recursive" replacements, e.g. expands -> physically expands
    // The processed set ensures that each added node is only processed once so the above doesn't happen
    #processed = new Set();
    // Also keep a copy of processed but that is cleared at the beginning of every callback
    // This prevents an added element whose characterData/attribute also mutated from being processed twice
    // While using processed would cause future mutations to a processed element's characterData/attribute to be ignored
    #callbackProcessed = new Set();
    #connected = true;

    // Keep track of all created observers to prevent infinite callbacks
    static #observers = new Set();

    // Use static read-only properties as class constants
    static get #IGNORED_NODES() {
        // Node types that implement the CharacterData interface but are not relevant or visible to the user
        return [Node.CDATA_SECTION_NODE, Node.PROCESSING_INSTRUCTION_NODE, Node.COMMENT_NODE];
    }
    static get #WATCHED_ATTRIBUTES() {
        // HTML attributes that get rendered as visible text
        return {
            'placeholder': ['input', 'textarea'],
            'alt': ['img', 'area', 'input[type="image"]', '[role="img"]'],
            'value': ['input[type="button"]'],
            'title': ['*'],
        };
    }
    static get #CONFIG() {
        return {
            subtree: true,
            childList: true,
            characterData: true,
            characterDataOldValue: true,
            attributeFilter: Object.keys(TextObserver.#WATCHED_ATTRIBUTES),
        };
    }

    // Override attachShadow to always force open mode so we can look inside them
    static #staticConstructor = (() => {
        Element.prototype._attachShadow = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function() {
            const shadowRoot = this._attachShadow({ mode: 'open' });
            // Find observers whose target includes the shadow
            const observers = [];
            for (const textObserver of TextObserver.#observers) {
                let found = false;
                for (const target of textObserver.#targets) {
                    if (target.contains(shadowRoot.host)) {
                        observers.push(textObserver.#observer);
                        found = true;
                        break;
                    }
                }
                if (textObserver.#performanceOptions.shadows && found) {
                    textObserver.#targets.add(shadowRoot);
                    textObserver.#processNodes(shadowRoot);
                }
            }
            observers.forEach(observer => observer.observe(shadowRoot, TextObserver.#CONFIG));
            return shadowRoot;
        };
    })();

    constructor(callback, target = document, processExisting = true, performanceOptions = {
        contentEditable: true,
        attributes: true,
        shadows: true,
        iconFonts: false,
        cssContent: false,
    }) {
        this.#callback = callback;
        this.#performanceOptions = performanceOptions;

        // If target is entire document, manually process <title> and skip the rest of the <head>
        // Processing the <head> can increase runtime by a factor of two
        if (target === document) {
            document.title = callback(document.title);
            // Sometimes <body> may be missing, like when viewing an .SVG file in the browser
            if (document.body !== null) {
                target = document.body;
            } else {
                console.warn('Document body does not exist, exiting...');
                return;
            }

        }
        this.#targets.add(target);

        if (processExisting) {
            TextObserver.#flushAndSleepDuring(() => this.#processNodes(target));
        }

        const observer = new MutationObserver(mutations => {
            // Disconnect every observer after collecting their records
            // Otherwise, the callback's mutations will trigger the observer and lead to an infinite feedback loop
            const records = [];
            for (const textObserver of TextObserver.#observers) {
                // This ternary is why this section does not use flushAndSleepDuring
                // It allows the nice-to-have property of callbacks being processed in the order they were declared
                records.push(textObserver === this ? mutations : textObserver.#observer.takeRecords());
                textObserver.#observer.disconnect();
            }
            let i = 0;
            for (const textObserver of TextObserver.#observers) {
                textObserver.#observerCallback(records[i]);
                i++;
            }

            TextObserver.#observers.forEach(textObserver => textObserver.#targets.forEach(
                target => textObserver.#observer.observe(target, TextObserver.#CONFIG)
            ));
        });
        // Attach an observer to each shadow root since MutationObserver objects can't see inside Shadow DOMs
        this.#targets.forEach(target => observer.observe(target, TextObserver.#CONFIG));

        this.#observer = observer;
        TextObserver.#observers.add(this);
    }

    disconnect(flush = true) {
        if (!this.#connected) {
            console.warn('This TextObserver instance is already disconnected!');
            return;
        }
        this.#connected = false;
        if (flush) {
            TextObserver.#flushAndSleepDuring(() => {});
        }
        this.#observer.disconnect();
        TextObserver.#observers.delete(this);
    }

    reconnect(reprocess = true) {
        if (this.#connected) {
            console.warn('This TextObserver instance is already connected!');
            return;
        }
        this.#connected = true;
        if (reprocess) {
            TextObserver.#flushAndSleepDuring(() => this.#targets.forEach(target => this.#processNodes(target)));
        }
        this.#targets.forEach(target => this.#observer.observe(target, TextObserver.#CONFIG));
        TextObserver.#observers.add(this);
    }

    #observerCallback(mutations) {
        this.#callbackProcessed.clear();
        // We must save attribute mutations and process them at the end
        // This is because adding them to processed would limit elements to one processed attribute per callback
        const attributeMutations = new Map();

        for (const mutation of mutations) {
            const target = mutation.target;
            const oldValue = mutation.oldValue;
            switch (mutation.type) {
                case 'childList':
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.TEXT_NODE) {
                            if (this.#valid(node) && !this.#processed.has(node)) {
                                node.nodeValue = this.#callback(node.nodeValue);
                                this.#processed.add(node);
                            }
                        } else if (!TextObserver.#IGNORED_NODES.includes(node.nodeType)) {
                            // If added node is not text, process subtree
                            this.#processNodes(node);
                        }
                    }
                    break;
                case 'characterData':
                    if (!this.#callbackProcessed.has(target) && this.#valid(target) && target.nodeValue !== oldValue) {
                        target.nodeValue = this.#callback(target.nodeValue);
                        this.#processed.add(target);
                        this.#callbackProcessed.add(target);
                    }
                    break;
                case 'attributes':
                    const attribute = mutation.attributeName;
                    if (this.#performanceOptions.attributes && target.getAttribute(attribute) !== oldValue) {
                        if (attributeMutations.get(target) === undefined) {
                            // Use a Set to prevent double-processing of the same attribute
                            attributeMutations.set(target, new Set());
                        }
                        attributeMutations.get(target).add(attribute);
                    }
                    break;
            }
        }

        for (const [target, attributes] of attributeMutations.entries()) {
            if (this.#callbackProcessed.has(target)) {
                continue;
            }
            for (const attribute of attributes) {
                // Find if element with changed attribute matches a valid selector
                const selectors = TextObserver.#WATCHED_ATTRIBUTES[attribute];
                let matched = false;
                for (const selector of selectors) {
                    if (target.matches(selector)) {
                        matched = true;
                        break;
                    }
                }
                const value = target.getAttribute(attribute);
                if (matched && value) {
                    target.setAttribute(attribute, this.#callback(value));
                }
            }
        }
    }

    static #flushAndSleepDuring(callback) {
        // Disconnect all other observers to prevent infinite callbacks
        const records = [];
        for (const textObserver of TextObserver.#observers) {
            // Collect pending mutation notifications
            records.push(textObserver.#observer.takeRecords());
            textObserver.#observer.disconnect();
        }
        // This is in its own separate loop from the above because we want to disconnect everything before proceeding
        // Otherwise, the mutations in the callback may trigger the other observers
        let i = 0;
        for (const textObserver of TextObserver.#observers) {
            textObserver.#observerCallback(records[i]);
            i++;
        }
        callback();
        TextObserver.#observers.forEach(textObserver => textObserver.#targets.forEach(
            target => textObserver.#observer.observe(target, TextObserver.#CONFIG)
        ));
    }

    #valid(node) {
        return (
            // Sometimes the node is removed from the document before we can process it, so check for valid parent
            node.parentNode !== null
            && !TextObserver.#IGNORED_NODES.includes(node.nodeType)
            // HTML tags that permit textual content but are not front-facing text
            && node.parentNode.tagName !== 'SCRIPT' && node.parentNode.tagName !== 'STYLE'
            // Ignore contentEditable elements as touching them messes up the cursor position
            && (!this.#performanceOptions.contentEditable || !node.parentNode.isContentEditable)
            // HACK: workaround to avoid breaking icon fonts
            && (!this.#performanceOptions.iconFonts || !window.getComputedStyle(node.parentNode).getPropertyValue('font-family').toUpperCase().includes('ICON'))
        );
    }

    #processNodes(root) {
        // Process valid Text nodes
        const nodes = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: node => (
            this.#valid(node) && !this.#processed.has(node)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        });
        while (nodes.nextNode()) {
            nodes.currentNode.nodeValue = this.#callback(nodes.currentNode.nodeValue);
            this.#processed.add(nodes.currentNode);
            this.#callbackProcessed.add(nodes.currentNode);
        }

        // Use temporary set since instantly adding would prevent elements from having multiple attributes/CSS processed
        const tempProcessed = new Set();

        // Process special attributes
        if (this.#performanceOptions.attributes) {
            for (const [attribute, selectors] of Object.entries(TextObserver.#WATCHED_ATTRIBUTES)) {
                root.querySelectorAll(selectors.join(', ')).forEach(element => {
                    if (!this.#processed.has(element)) {
                        const value = element.getAttribute(attribute);
                        if (value !== null) {
                            element.setAttribute(attribute, this.#callback(value));
                        }
                        tempProcessed.add(element);
                    }
                });
            }
        }

        // Process CSS generated text
        if (this.#performanceOptions.cssContent) {
            const styleElement = document.createElement('style');
            document.head.appendChild(styleElement);
            let styles = '';
            let i = 0;
            const elements = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
                acceptNode: node => !this.#processed.has(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
            });
            while (elements.nextNode()) {
                const node = elements.currentNode;
                // Check every pseudo-element that accepts the content property
                for (const pseudoClass of ['::before', '::after', '::marker']) {
                    const content = window.getComputedStyle(node, pseudoClass).content;
                    // Only process values that are plain single or double quote strings
                    if (/^'[^']+'$/.test(content) || /^"[^"]+"$/.test(content)) {
                        const newClass = 'TextObserverHelperAssigned' + i;
                        node.classList.add(newClass);
                        // Substring is needed to cut off open and close quote
                        styles += `.${newClass}${pseudoClass} {
                            content: "${this.#callback(content.substring(1, content.length - 1))}" !important;
                        }`;
                        tempProcessed.add(node);
                    }
                }
                i++;
            }
            styleElement.textContent = styles;
        }

        for (const element of tempProcessed) {
            this.#processed.add(element);
            this.#callbackProcessed.add(element);
        }

        // Manually find and process open Shadow DOMs because MutationObserver doesn't pick them up
        if (this.#performanceOptions.shadows) {
            const shadowRoots = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
                acceptNode: node => node.shadowRoot ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
            });
            let shadowRoot = shadowRoots.currentNode.shadowRoot;
            // First node may or may not have a shadow root
            if (!shadowRoot) {
                shadowRoot = shadowRoots.nextNode();
            }
            while (shadowRoot) {
                // Add newly found shadow roots to targets
                if (!this.#targets.has(shadowRoot)) {
                    this.#processNodes(shadowRoot);
                    this.#targets.add(shadowRoot);
                    // This function is called in the constructor before the observer is defined, so check that
                    if (this.#observer !== undefined) {
                        this.#observer.observe(shadowRoot, TextObserver.#CONFIG);
                    }
                }
                shadowRoot = shadowRoots.nextNode();
            }
        }
    }
}
