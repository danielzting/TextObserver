class TextObserver {
    #targets;
    #callback;
    #observer;
    #performanceOptions;
    #processed;

    // Keep track of all created observers to prevent infinite callbacks
    static #observers = new Set();

    // Use static read-only properties as class constants
    static get #IGNORED_NODES() {
        // Node types that implement the CharacterData interface but are not relevant or visible to the user
        return [Node.CDATA_SECTION_NODE, Node.PROCESSING_INSTRUCTION_NODE, Node.COMMENT_NODE];
    }
    static get #IGNORED_TAGS() {
        // Text nodes that are not front-facing content
        return ['SCRIPT', 'STYLE', 'NOSCRIPT'];
    }
    static get #WATCHED_ATTRIBUTES() {
        // HTML attributes that get rendered as visible text
        return {
            'placeholder': ['input', 'textarea'],
            'alt': ['img', 'area', 'input[type="image"]', '[role="img"]'],
            'value': ['input:not([type])', 'input[type="text"]', 'input[type="button"]'],
            'title': ['*'],
        };
    }
    static get #WATCHED_CSS() {
        // CSS pseudo-elements that can have the content property set
        return ['::before', '::after', '::marker'];
    }
    static get #CONFIG() {
        return {
            subtree: true,
            childList: true,
            characterData: true,
            attributeFilter: Object.keys(TextObserver.#WATCHED_ATTRIBUTES),
        };
    }

    constructor(callback, target = document, processExisting = true, performanceOptions = {
        contentEditable: true,
        attributes: true,
        iconFonts: false,
        cssContent: false,
    }) {
        this.#callback = callback;
        this.#performanceOptions = performanceOptions;
        this.#processed = new Set();

        // If target is entire document, manually process <title> and skip the rest of the <head>
        // Processing the <head> can increase runtime by a factor of two
        if (target === document) {
            document.title = callback(document.title);
            // Sometimes <body> may be missing, like when viewing an .SVG file in the browser
            if (document.body !== null) {
                target = document.body;
            }

        }
        this.#targets = [target];
        [].slice.call(target.getElementsByTagName('*'), 0)
            .filter(element => element.shadowRoot)
            .forEach(element => this.#targets.push(element.shadowRoot));

        if (processExisting) {
            TextObserver.#flushAndSleepDuring(this.#processNodes.bind(this, target, callback));
        }

        const observer = new MutationObserver(mutations => {
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
        this.#targets.forEach(target => observer.observe(target, TextObserver.#CONFIG));

        this.#observer = observer;
        TextObserver.#observers.add(this);
    }

    disconnect(flush = true) {
        const mutations = this.#observer.takeRecords();
        this.#observer.disconnect();
        TextObserver.#observers.delete(this);
        if (flush) {
            TextObserver.#flushAndSleepDuring(() => {});
        }
    }

    reconnect(reprocess = true) {
        if (reprocess) {
            TextObserver.#flushAndSleepDuring(this.#processNodes.bind(this, this.#targets[0], this.#callback));
        }
        this.#targets.forEach(target => this.#observer.observe(target, TextObserver.#CONFIG));
        TextObserver.#observers.add(this);
    }

    #observerCallback(mutations) {
        // Sometimes, MutationRecords of type 'childList' have added nodes with overlapping subtrees
        // This can cause resource usage to explode with "recursive" replacements, e.g. expands -> physically expands
        // The processed set ensures that each added node is only processed once so the above doesn't happen
        this.#processed.clear();
        for (const mutation of mutations) {
            const target = mutation.target;
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
                            this.#processNodes(node, this.#callback);
                        }
                    }
                    break;
                case 'characterData':
                    if (this.#valid(target) && !this.#processed.has(target)) {
                        target.nodeValue = this.#callback(target.nodeValue);
                        this.#processed.add(target);
                    }
                    break;
                case 'attributes':
                    if (!this.#performanceOptions.attributes || this.#processed.has(target)) {
                        break;
                    }
                    // We must process every attribute at once because this code adds to processed
                    for (const [attribute, selectors] of Object.entries(TextObserver.#WATCHED_ATTRIBUTES)) {
                        // Find if element with changed attribute matches a watched selector
                        let matched = false;
                        for (const selector of selectors) {
                            if (target.matches(selector)) {
                                matched = true;
                                break;
                            }
                        }
                        if (matched) {
                            target.setAttribute(attribute, this.#callback(target.getAttribute(mutation.attributeName)));
                        }
                    }
                    this.#processed.add(target);
                    break;
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
            && !TextObserver.#IGNORED_TAGS.includes(node.parentNode.tagName)
            // Ignore contentEditable elements as touching them messes up the cursor position
            && (!this.#performanceOptions.contentEditable || !node.parentNode.isContentEditable)
            // HACK: workaround to avoid breaking icon fonts
            && (!this.#performanceOptions.iconFonts || !window.getComputedStyle(node.parentNode).getPropertyValue('font-family').toUpperCase().includes('ICON'))
        );
    }

    #processNodes(root, callback) {
        // Process valid Text nodes
        const nodes = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: node => (
            this.#valid(node) && !this.#processed.has(node)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        });
        while (nodes.nextNode()) {
            nodes.currentNode.nodeValue = callback(nodes.currentNode.nodeValue);
            this.#processed.add(nodes.currentNode);
        }
        // Use temporary set since instantly adding would prevent elements from having multiple attributes/CSS processed
        const tempProcessed = new Set();
        if (this.#performanceOptions.attributes) {
            // Process special attributes
            for (const [attribute, selectors] of Object.entries(TextObserver.#WATCHED_ATTRIBUTES)) {
                root.querySelectorAll(selectors.join(', ')).forEach(element => {
                    if (!this.#processed.has(element)) {
                        const value = element.getAttribute(attribute);
                        if (value !== null) {
                            element.setAttribute(attribute, callback(value));
                        }
                        tempProcessed.add(element);
                    }
                });
            }
        }
        if (this.#performanceOptions.cssContent) {
            // Process CSS generated text
            const styleElement = document.createElement('style');
            document.head.appendChild(styleElement);
            let styles = '';
            let i = 0;
            const elements = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
                acceptNode: node => !this.#processed.has(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
            });
            while (elements.nextNode()) {
                const node = elements.currentNode;
                for (const pseudoClass of TextObserver.#WATCHED_CSS) {
                    const content = window.getComputedStyle(node, pseudoClass).content;
                    if (/^'[^']+'$/.test(content) || /^"[^"]+"$/.test(content)) {
                        const newClass = 'TextObserverHelperAssigned' + i;
                        node.classList.add(newClass);
                        styles += `.${newClass}${pseudoClass} {
                            content: "${callback(content.substring(1, content.length - 1))}" !important;
                        }`;
                        tempProcessed.add(node);
                    }
                }
                i++;
            }
            styleElement.textContent = styles;
            for (const element of tempProcessed) {
                this.#processed.add(element);
            }
        }
        // Process open Shadow DOM subtrees
        const shadowRoots = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
            acceptNode: node => node.shadowRoot ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
        });
        while (shadowRoots.nextNode()) {
            this.#processNodes(shadowRoots.currentNode.shadowRoot, callback);
        }
    }
}
