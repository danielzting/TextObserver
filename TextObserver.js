class TextObserver {
    // Exclude Text nodes that are not user-readable content
    static #IGNORED_TAGS = ['SCRIPT', 'STYLE', 'NOSCRIPT'];
    static #CONFIG = {
        subtree: true,
        childList: true,
        characterData: true,
        attributeFilter: ['placeholder'], // For <input> and <textarea>
    };


    constructor(callback, target = document.body) {
        // Perform initial round
        TextObserver.#processNodes(target, callback);
        // Manually process placeholder attribute of <input> and <textarea> elements
        // TODO: Is there a more elegant way to do this?
        const elements = document.querySelectorAll('input, textarea');
        elements.forEach(element => element.placeholder = callback(element.placeholder));

        function observerCallback(mutations, observer) {
            // Disconnect observer before callback to prevent infinite recursion
            observer.disconnect();

            for (const mutation of mutations) {
                const mutated = mutation.target;

                switch (mutation.type) {
                    case 'childList':
                        for (const addedNode of mutation.addedNodes) {
                            if (addedNode.nodeType === Node.TEXT_NODE) {
                                if (TextObserver.#valid(addedNode)) {
                                    addedNode.nodeValue = callback(addedNode.nodeValue);
                                }
                            } else {
                                // If added node is not text, process Text nodes in subtree
                                TextObserver.#processNodes(addedNode, callback);
                            }
                        }
                        break;
                    case 'characterData':
                        if (TextObserver.#valid(mutated)) {
                            mutated.nodeValue = callback(mutated.nodeValue);
                        }
                        break;
                    case 'attributes':
                        mutated[mutation.attributeName] = callback(mutated[mutation.attributeName]);
                        break;
                }
            }

            observer.observe(target, TextObserver.#CONFIG);
        }

        const observer = new MutationObserver(observerCallback);
        observer.observe(target, TextObserver.#CONFIG);
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
        const nodes = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    return TextObserver.#valid(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                }
            },
        );
        while (nodes.nextNode()) {
            nodes.currentNode.nodeValue = callback(nodes.currentNode.nodeValue);
        }
    }
}
