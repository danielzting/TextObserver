class TextObserver {
    #target;
    #callback;
    #observer;

    // Use static read-only properties as class constants
    static get #IGNORED_TAGS() {
        return ['SCRIPT', 'STYLE', 'NOSCRIPT'];
    }
    static get #CONFIG() {
        return {
            subtree: true,
            childList: true,
            characterData: true,
            attributeFilter: ['placeholder'], // For <input> and <textarea>
        };
    }

    // Keep track of all created observers to prevent infinite callbacks
    static #observers = new Set();

    constructor(callback, target = document.body) {
        this.#target = target;
        this.#callback = callback;
        TextObserver.#flushAndSleepDuring(TextObserver.#processNodes.bind(null, target, callback));

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

    reconnect(rerun = true) {
        if (rerun) {
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
                    for (const addedNode of mutation.addedNodes) {
                        if (addedNode.nodeType === Node.TEXT_NODE) {
                            if (TextObserver.#valid(addedNode) && !processed.has(addedNode)) {
                                addedNode.nodeValue = this.#callback(addedNode.nodeValue);
                                processed.add(addedNode);
                            }
                        } else {
                            // If added node is not text, process subtree
                            TextObserver.#processNodes(addedNode, this.#callback, processed);
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
                    if (!processed.has(target)) {
                        target[mutation.attributeName] = this.#callback(target[mutation.attributeName]);
                        processed.add(target);
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
        if (callback) {
            callback();
        }
        TextObserver.#observers.forEach(value => value.#observer.observe(value.#target, TextObserver.#CONFIG));
    }

    static #valid(node) {
        return (
            node.parentNode !== null
            && !TextObserver.#IGNORED_TAGS.includes(node.parentNode.tagName)
            // Ignore contentEditable elements as touching them messes up the cursor position
            && !node.parentNode.isContentEditable
            // HACK: workaround to avoid breaking icon fonts
            && !window.getComputedStyle(node.parentNode).getPropertyValue('font-family').toUpperCase().includes('ICON')
        );
    }

    static #processNodes(root, callback, processed = null) {
        TextObserver.#processText(root, callback, processed);
        // Manually process placeholder attribute of <input> and <textarea> elements
        // TODO: Is there a more elegant way to do this?
        const elements = root.querySelectorAll('input, textarea');
        elements.forEach(element => {
            if (processed === null || !processed.has(element)) {
                element.placeholder = callback(element.placeholder);
                if (processed !== null) {
                    processed.add(element);
                }
            }
        });
    }

    static #processText(root, callback, processed = null) {
        const nodes = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: node => TextObserver.#valid(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        });
        while (nodes.nextNode()) {
            if (processed === null || !processed.has(nodes.currentNode)) {
                nodes.currentNode.nodeValue = callback(nodes.currentNode.nodeValue);
                if (processed !== null) {
                    processed.add(nodes.currentNode);
                }
            }
        }
    }
}
