class TextObserver {
    #target;
    #callback;
    #observer;

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
            'alt': ['img', 'area'],
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

    constructor(callback, target = document, processExisting = true) {
        // If target is entire document, manually process <title> and skip the rest of the <head>
        // Processing the <head> can increase runtime by a factor of two
        if (target === document) {
            document.title = callback(document.title);
            // Sometimes <body> may be missing, like when viewing an .SVG file in the browser
            if (document.body !== null) {
                target = document.body;
            }
        }
        this.#target = target;
        this.#callback = callback;
        if (processExisting) {
            TextObserver.#flushAndSleepDuring(TextObserver.#processNodes.bind(null, target, callback));
        }

        const observer = new MutationObserver(mutations => {
            const records = [];
            for (const value of TextObserver.#observers) {
                // This ternary is why this section does not use flushAndSleepDuring.
                // It allows the nice-to-have property of callbacks being processed in the order they were declared.
                records.push(value === this ? mutations : value.#observer.takeRecords());
                value.#observer.disconnect();
            }
            let i = 0;
            for (const value of TextObserver.#observers) {
                value.#observerCallback(records[i++]);
            }

            TextObserver.#observers.forEach(value => value.#observer.observe(value.#target, TextObserver.#CONFIG));
        });
        observer.observe(target, TextObserver.#CONFIG);

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
            TextObserver.#flushAndSleepDuring(TextObserver.#processNodes.bind(null, this.#target, this.#callback));
        }
        this.#observer.observe(this.#target, TextObserver.#CONFIG);
        TextObserver.#observers.add(this);
    }

    #observerCallback(mutations) {
        // NOTE: Sometimes, MutationRecords of type 'childList' have added nodes with overlapping subtrees.
        // This can cause resource usage to explode with "recursive" replacements, e.g. expands -> physically expands.
        // The processed set ensures that each added node is only processed once so the above doesn't happen.
        const processed = new Set();
        for (const mutation of mutations) {
            const target = mutation.target;
            switch (mutation.type) {
                case 'childList':
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.TEXT_NODE) {
                            if (TextObserver.#valid(node) && !processed.has(node)) {
                                node.nodeValue = this.#callback(node.nodeValue);
                                processed.add(node);
                            }
                        } else if (!TextObserver.#IGNORED_NODES.includes(node.nodeType)) {
                            // If added node is not text, process subtree
                            TextObserver.#processNodes(node, this.#callback, processed);
                        }
                    }
                    break;
                case 'characterData':
                    if (TextObserver.#valid(target) && !processed.has(target)) {
                        target.nodeValue = this.#callback(target.nodeValue);
                        processed.add(target);
                    }
                    break;
                case 'attributes':
                    const attribute = mutation.attributeName;
                    const elements = TextObserver.#WATCHED_ATTRIBUTES[attribute];
                    const value = target.getAttribute(attribute);
                    // NOTE: This relies on the assumption that each element/tag/type has at most one watched attribute.
                    // If this is updated to watch multiple attributes on a single tag, this logic MUST be rewritten!
                    if (!processed.has(target) && value !== null) {
                        if (elements[0] === '*' || elements.includes(target.tagName.toLowerCase())) {
                            target.setAttribute(attribute, this.#callback(value));
                            processed.add(target);
                        }
                    }
                    break;
            }
        }
    }

    static #flushAndSleepDuring(callback) {
        // Disconnect all other observers to prevent infinite callbacks
        const records = [];
        for (const value of TextObserver.#observers) {
            // Collect pending mutation notifications
            records.push(value.#observer.takeRecords());
            value.#observer.disconnect();
        }
        // This is in its own separate loop from the above because we want to disconnect everything before proceeding.
        // Otherwise, the mutations in the callback may trigger the other observers.
        let i = 0;
        for (const value of TextObserver.#observers) {
            value.#observerCallback(records[i++]);
        }
        callback();
        TextObserver.#observers.forEach(value => value.#observer.observe(value.#target, TextObserver.#CONFIG));
    }

    static #valid(node) {
        return (
            // Sometimes the node is removed from the document before we can process it, so check for valid parent
            node.parentNode !== null
            && !TextObserver.#IGNORED_NODES.includes(node.nodeType)
            && !TextObserver.#IGNORED_TAGS.includes(node.parentNode.tagName)
            // Ignore contentEditable elements as touching them messes up the cursor position
            && !node.parentNode.isContentEditable
            // HACK: workaround to avoid breaking icon fonts
            && !window.getComputedStyle(node.parentNode).getPropertyValue('font-family').toUpperCase().includes('ICON')
        );
    }

    static #processNodes(root, callback, processed = null) {
        // Process valid Text nodes
        const nodes = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: node => (
            TextObserver.#valid(node) && !processed?.has(node)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        });
        while (nodes.nextNode()) {
            nodes.currentNode.nodeValue = callback(nodes.currentNode.nodeValue);
            processed?.add(nodes.currentNode);
        }
        // For keeping track of styles and IDs for CSS processing
        let styles = document.createElement('style');
        let generated = '';
        document.head.appendChild(styles);
        let i = 0;
        // Process special attributes
        for (const [attribute, elements] of Object.entries(TextObserver.#WATCHED_ATTRIBUTES)) {
            root.querySelectorAll(elements.join(', ')).forEach(element => {
                // NOTE: This relies on the assumption that each element/tag/type has at most one watched attribute.
                // If this is updated to watch multiple attributes on a single tag, this logic MUST be rewritten!
                if (!processed?.has(element)) {
                    const value = element.getAttribute(attribute);
                    if (value !== null) {
                        element.setAttribute(attribute, callback(value));
                    }
                    // HACK: This function is called here as well because this section of code adds to processed.
                    // Otherwise, elements that get their attributes processed won't get their CSS processed.
                    // TODO: consider switching the data structure for processed and refactoring the relevant logic
                    generated += TextObserver.#processCSS(element, callback, i++);
                    processed?.add(element);
                }
            });
        }
        // Process CSS generated text
        const elements = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
            acceptNode: node => !processed?.has(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        });
        while (elements.nextNode()) {
            generated += TextObserver.#processCSS(elements.currentNode, callback, i++);
            processed?.add(elements.currentNode);
        }
        styles.textContent = generated;
    }

    static #processCSS(node, callback, i) {
        // HACK: This whole function is an ugly workaround to process the CSS content property.
        let styles = '';
        for (const pseudoClass of TextObserver.#WATCHED_CSS) {
            const content = window.getComputedStyle(node, pseudoClass).content;
            if (/^['"].+["']$/.test(content)) {
                if (node.id == '') {
                    node.id = 'TextObserverHelperAssigned' + i;
                }
                styles += `#${node.id}${pseudoClass} { content: "${callback(content.substring(1, content.length - 1))}" !important }`;
            }
        }
        return styles;
    }
}
