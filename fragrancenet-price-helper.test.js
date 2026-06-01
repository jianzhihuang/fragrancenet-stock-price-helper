const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class Element {
    constructor(tagName, text = '') {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.dataset = {};
        this.style = {};
        this.type = '';
        this.value = '';
        this.id = '';
        this.className = '';
        this._text = text;
        this._innerHTML = '';
    }

    get textContent() {
        return this._text + this.children.map(child => child.textContent).join('');
    }

    set textContent(value) {
        this._text = value;
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(value) {
        this._innerHTML = value;
        this._text = value;
    }

    get previousElementSibling() {
        if (!this.parentNode) return null;
        const index = this.parentNode.children.indexOf(this);
        return index > 0 ? this.parentNode.children[index - 1] : null;
    }

    get classList() {
        return {
            contains: name => this.className.split(/\s+/).includes(name)
        };
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    insertBefore(child, reference) {
        child.parentNode = this;
        const index = this.children.indexOf(reference);
        if (index === -1) {
            this.children.push(child);
        } else {
            this.children.splice(index, 0, child);
        }
        return child;
    }

    remove() {
        if (!this.parentNode) return;
        const index = this.parentNode.children.indexOf(this);
        if (index !== -1) this.parentNode.children.splice(index, 1);
        this.parentNode = null;
    }

    contains(target) {
        return this === target || this.children.some(child => child.contains(target));
    }

    querySelector(selector) {
        return collect(this).find(el => matches(el, selector)) || null;
    }

    querySelectorAll(selector) {
        return collect(this).filter(el => matches(el, selector));
    }
}

class ScriptElement extends Element {
    constructor(json) {
        super('script', JSON.stringify(json));
        this.type = 'application/ld+json';
    }
}

class Document {
    constructor(children) {
        this.head = new Element('head');
        this.documentElement = new Element('html');
        this.body = new Element('body');
        this.documentElement.appendChild(this.head);
        this.documentElement.appendChild(this.body);
        children.forEach(child => this.body.appendChild(child));
    }

    createElement(tagName) {
        return new Element(tagName);
    }

    querySelectorAll(selector) {
        return this.documentElement.querySelectorAll(selector);
    }
}

function collect(root) {
    return [root, ...root.children.flatMap(child => collect(child))];
}

function matches(el, selector) {
    if (selector.includes(',')) {
        return selector.split(',').some(part => matches(el, part.trim()));
    }
    if (selector === '*') return true;
    if (selector === 'button') return el.tagName === 'BUTTON';
    if (selector === 'input[type="submit"]') return el.tagName === 'INPUT' && el.type === 'submit';
    if (selector === 'script[type="application/ld+json"]') {
        return el.tagName === 'SCRIPT' && el.type === 'application/ld+json';
    }
    if (selector.startsWith('.')) return el.classList.contains(selector.slice(1));
    return false;
}

function runScript(document, pageWindow = {}) {
    const code = fs.readFileSync('fragrancenet-price-helper.user.js', 'utf8');
    vm.runInNewContext(code, {
        document,
        window: pageWindow,
        console: { log() {}, warn() {} },
        MutationObserver: class { observe() {} },
        setInterval() {},
        setTimeout(fn) { fn(); return 1; },
        clearTimeout() {}
    });
}

function productPanel(sku) {
    const panel = new Element('div');
    panel.appendChild(new Element('span', `Item #${sku}`));
    panel.appendChild(new Element('button', 'Notify Me'));
    return panel;
}

function bannerText(panel) {
    const banner = panel.querySelector('.fnet-injected-price-banner');
    return banner ? banner.innerHTML : '';
}

function testNestedVariantPriceIsDisplayed() {
    const panel = productPanel('488007');
    const document = new Document([
        new ScriptElement({
            '@type': 'ProductGroup',
            hasVariant: [{
                '@type': 'Product',
                sku: '488007',
                offers: {
                    price: '19.99',
                    priceCurrency: 'USD'
                }
            }]
        }),
        panel
    ]);

    runScript(document);

    assert.match(bannerText(panel), /\$19\.99/);
}

function testNotifyButtonUsesNearestSku() {
    const firstPanel = productPanel('111111');
    const secondPanel = productPanel('222222');
    const document = new Document([
        new ScriptElement([{
            '@type': 'Product',
            sku: '111111',
            offers: { price: '10.00', priceCurrency: 'USD' }
        }, {
            '@type': 'Product',
            sku: '222222',
            offers: { price: '22.00', priceCurrency: 'USD' }
        }]),
        firstPanel,
        secondPanel
    ]);

    runScript(document);

    assert.match(bannerText(secondPanel), /\$22\.00/);
    assert.doesNotMatch(bannerText(secondPanel), /\$10\.00/);
}

function testSoldOutEmailFormUsesSingleJsonLdPriceWithoutVisibleSku() {
    const panel = new Element('div');
    panel.appendChild(new Element('p', 'We apologize, we are currently sold out'));
    panel.appendChild(new Element('p', 'please enter your email address below:'));
    panel.appendChild(new Element('button', 'SUBMIT'));
    const document = new Document([
        new ScriptElement({
            '@type': 'Product',
            sku: '333333',
            offers: {
                price: '33.00',
                priceCurrency: 'USD'
            }
        }),
        panel
    ]);

    runScript(document);

    assert.match(bannerText(panel), /\$33\.00/);
    assert.match(bannerText(panel), /Item #333333/);
}

function testSoldOutSubmitInputUsesSkuMapPriceWithoutVisibleSku() {
    const panel = new Element('div');
    panel.className = 'rightZone cf oos';
    panel.appendChild(new Element('p', 'We apologize, we are currently sold out'));
    panel.appendChild(new Element('p', 'If you would like to be notified when it becomes available, please enter your email address below:'));
    const form = new Element('form');
    form.id = 'oosForm';
    const buttonWrapper = new Element('div');
    buttonWrapper.className = 'fragnetButton aqua';
    const submit = new Element('input');
    submit.type = 'submit';
    submit.id = 'oosSubmit';
    submit.value = 'Submit';
    buttonWrapper.appendChild(submit);
    form.appendChild(buttonWrapper);
    panel.appendChild(form);
    const document = new Document([panel]);

    runScript(document, {
        currentSku: '416615',
        sku_map: {
            416615: {
                discount_price: '18.74'
            }
        }
    });

    assert.match(bannerText(panel), /\$18\.74/);
    assert.match(bannerText(panel), /Item #416615/);
}

testNestedVariantPriceIsDisplayed();
testNotifyButtonUsesNearestSku();
testSoldOutEmailFormUsesSingleJsonLdPriceWithoutVisibleSku();
testSoldOutSubmitInputUsesSkuMapPriceWithoutVisibleSku();
console.log('All tests passed');
