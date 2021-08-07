class TextObserver {
    #target;
    #callback;
    #observer;

    // Use static read-only properties as class constants
    static get #IGNORED_NODES() {
        return [Node.CDATA_SECTION_NODE, Node.PROCESSING_INSTRUCTION_NODE, Node.COMMENT_NODE];
    }
    static get #IGNORED_TAGS() {
        return ['SCRIPT', 'STYLE', 'NOSCRIPT'];
    }
    static get #WATCHED_ATTRIBUTES() {
        return {
            'placeholder': ['input', 'textarea'],
            'alt': ['img', 'area'],
            'title': ['*'],
        };
    }
    static get #CONFIG() {
        return {
            subtree: true,
            childList: true,
            characterData: true,
            attributeFilter: Object.keys(TextObserver.#WATCHED_ATTRIBUTES),
        };
    }

    // Keep track of all created observers to prevent infinite callbacks
    static #observers = new Set();

    constructor(callback, target = document.body, processExisting = true) {
        this.#target = target;
        this.#callback = callback;
        if (processExisting) {
            TextObserver.#flushAndSleepDuring(TextObserver.#processNodes.bind(null, target, callback));
        }

        const observer = new MutationObserver(mutations => {
            // Disconnect all other observers to prevent infinite callbacks
            const records = [];
            for (const value of TextObserver.#observers) {
                // Process pending mutation records
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
        // Ensure each node only gets processed once
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
                    if (TextObserver.#valid(target) && !processed.has(addedNode)) {
                        target.nodeValue = this.#callback(target.nodeValue);
                        processed.add(target);
                    }
                    break;
                case 'attributes':
                    const attribute = mutation.attributeName;
                    const elements = TextObserver.#WATCHED_ATTRIBUTES[attribute];
                    // NOTE: This relies on the assumption that each element/tag/type has at most one watched attribute.
                    // If this is updated to watch multiple attributes on a single tag, this logic MUST be rewritten!
                    if (!processed.has(target)) {
                        if (elements === ['*'] || elements.includes(target.tagName.toLowerCase())) {
                            target[attribute] = this.#callback(target[attribute]);
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
            // Process pending mutation records
            records.push(value.#observer.takeRecords());
            value.#observer.disconnect();
        }
        let i = 0;
        for (const value of TextObserver.#observers) {
            value.#observerCallback(records[i++]);
        }
        callback();
        TextObserver.#observers.forEach(value => value.#observer.observe(value.#target, TextObserver.#CONFIG));
    }

    static #valid(node) {
        return (
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
        // Process special attributes
        for (const [attribute, elements] of Object.entries(TextObserver.#WATCHED_ATTRIBUTES)) {
            root.querySelectorAll(elements.join(', ')).forEach(element => {
                if (!processed?.has(element)) {
                    if (element[attribute] !== undefined) {
                        element[attribute] = callback(element[attribute]);
                    }
                    processed?.add(element);
                }
            });
        }
    }
}
