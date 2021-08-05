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

    constructor(callback, target = document.body) {
        this.#target = target;
        this.#callback = callback;
        TextObserver.#processNodes(target, callback);

        const observer = new MutationObserver(mutations => {
            // Disconnect observer before callback to prevent infinite recursion
            this.#observer.disconnect();
            this.#observerCallback(mutations);
            this.#observer.observe(target, TextObserver.#CONFIG);
        });
        observer.observe(target, TextObserver.#CONFIG);
        this.#observer = observer;
    }

    disconnect(flush = true) {
        const mutations = this.#observer.takeRecords();
        this.#observer.disconnect();
        if (flush) {
            this.#observerCallback(mutations);
        }
    }

    reconnect(rerun = true) {
        if (rerun) {
            TextObserver.#processNodes(this.#target, this.#callback);
        }
        this.#observer.observe(this.#target, TextObserver.#CONFIG);
    }

    #observerCallback(mutations) {
        for (const mutation of mutations) {
            const mutated = mutation.target;
            switch (mutation.type) {
                case 'childList':
                    for (const addedNode of mutation.addedNodes) {
                        if (addedNode.nodeType === Node.TEXT_NODE) {
                            if (TextObserver.#valid(addedNode)) {
                                addedNode.nodeValue = this.#callback(addedNode.nodeValue);
                            }
                        } else {
                            // If added node is not text, process Text nodes in subtree
                            TextObserver.#processText(addedNode, this.#callback);
                        }
                    }
                    break;
                case 'characterData':
                    if (TextObserver.#valid(mutated)) {
                        mutated.nodeValue = this.#callback(mutated.nodeValue);
                    }
                    break;
                case 'attributes':
                    mutated[mutation.attributeName] = this.#callback(mutated[mutation.attributeName]);
                    break;
            }
        }
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

    static #processNodes(root, callback) {
        TextObserver.#processText(root, callback);
        // Manually process placeholder attribute of <input> and <textarea> elements
        // TODO: Is there a more elegant way to do this?
        const elements = document.querySelectorAll('input, textarea');
        elements.forEach(element => element.placeholder = callback(element.placeholder));
    }

    static #processText(root, callback) {
        const nodes = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: node => TextObserver.#valid(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        });
        while (nodes.nextNode()) {
            nodes.currentNode.nodeValue = callback(nodes.currentNode.nodeValue);
        }
    }
}
