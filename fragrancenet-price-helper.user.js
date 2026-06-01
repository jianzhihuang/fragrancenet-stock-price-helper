// ==UserScript==
// @name         FragranceNet 缺貨商品背景價格顯示器
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  在 FragranceNet 上針對任何缺貨的商品，自動解析背景 JSON-LD 結構化資料，並在「Notify Me」按鈕上方與商品編號旁顯示背景隱藏價格。
// @author       Antigravity
// @match        https://www.fragrancenet.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // 儲存 SKU -> 價格與幣別資訊的對照表
    let skuPriceMap = {};
    let debounceTimer = null;

    // 解析 JSON-LD 結構化資料
    function parseJsonLd() {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        scripts.forEach(script => {
            try {
                // 避開已解析過的標籤，提升效能
                if (script.dataset.parsedByPriceHelper) return;
                script.dataset.parsedByPriceHelper = 'true';

                const data = JSON.parse(script.textContent);
                const items = Array.isArray(data) ? data : [data];

                items.forEach(item => {
                    if (item && item['@type'] === 'Product') {
                        const offers = item.offers;
                        if (offers) {
                            const offerList = Array.isArray(offers) ? offers : [offers];
                            offerList.forEach(offer => {
                                const sku = offer.sku || item.sku;
                                const price = offer.price;
                                const currency = offer.priceCurrency || 'USD';
                                if (sku && price !== undefined) {
                                    skuPriceMap[sku.trim()] = {
                                        price: parseFloat(price).toFixed(2),
                                        currency: currency
                                    };
                                }
                            });
                        }
                    }
                });
            } catch (e) {
                // 忽略格式錯誤的 JSON
            }
        });
    }

    // 取得當前頁面上所有顯現出來的商品編號（Item #）
    function getActiveSkusOnPage() {
        const skus = new Set();
        const elements = document.querySelectorAll('span, div, p, font, h1, h2');
        elements.forEach(el => {
            if (el.children.length === 0 && el.textContent.includes('Item #')) {
                const match = el.textContent.match(/Item\s*#\s*(\d+)/i);
                if (match) {
                    skus.add(match[1].trim());
                }
            }
        });
        return Array.from(skus);
    }

    // 執行價格注入邏輯
    function injectPrices() {
        parseJsonLd();

        // 1. 在商品編號「Item #XXXXXX」旁注入精美小紫色標籤
        const elements = document.querySelectorAll('span, div, p, font');
        elements.forEach(el => {
            if (el.children.length === 0 && el.textContent.includes('Item #') && !el.dataset.priceInjected) {
                const match = el.textContent.match(/Item\s*#\s*(\d+)/i);
                if (match) {
                    const sku = match[1].trim();
                    const priceInfo = skuPriceMap[sku];
                    if (priceInfo) {
                        el.dataset.priceInjected = 'true';
                        
                        const badge = document.createElement('span');
                        badge.style.display = 'inline-flex';
                        badge.style.alignItems = 'center';
                        badge.style.marginLeft = '10px';
                        badge.style.padding = '2px 8px';
                        badge.style.borderRadius = '12px';
                        badge.style.backgroundColor = '#f3e8ff'; // 溫和淡紫
                        badge.style.color = '#522555';           // 官網品牌深紫
                        badge.style.fontWeight = '600';
                        badge.style.fontSize = '12px';
                        badge.style.border = '1px solid #e9d5ff';
                        badge.style.boxShadow = '0 1px 2px rgba(82, 37, 85, 0.08)';
                        badge.style.transition = 'all 0.2s ease';
                        badge.textContent = `背景售價: $${priceInfo.price} ${priceInfo.currency}`;
                        
                        el.appendChild(badge);
                    }
                }
            }
        });

        // 2. 在缺貨的「Notify me When Available」按鈕上方，生成價格提示大看板
        const buttons = document.querySelectorAll('button');
        buttons.forEach(btn => {
            const hasNotifyText = btn.textContent.toLowerCase().includes('notify me');
            if (hasNotifyText && !btn.dataset.priceBannerInjected) {
                btn.dataset.priceBannerInjected = 'true';

                // 抓取此按鈕當前關聯的 SKU 編號
                const activeSkus = getActiveSkusOnPage();
                if (activeSkus.length > 0) {
                    const activeSku = activeSkus[0];
                    const priceInfo = skuPriceMap[activeSku];

                    if (priceInfo) {
                        // 建立外觀高雅的虛線外框看板
                        const banner = document.createElement('div');
                        banner.className = 'fnet-injected-price-banner';
                        banner.style.width = '100%';
                        banner.style.background = 'rgba(82, 37, 85, 0.04)';
                        banner.style.border = '1.5px dashed #522555';
                        banner.style.borderRadius = '8px';
                        banner.style.padding = '12px 15px';
                        banner.style.marginBottom = '14px';
                        banner.style.textAlign = 'center';
                        banner.style.boxSizing = 'border-box';
                        banner.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
                        banner.style.animation = 'fadeInDown 0.3s ease-out';
                        
                        // 價格計算並排版呈現（包含虛擬的原價對比與背景底價標註）
                        banner.innerHTML = `
                            <div style="color: #666666; font-size: 12px; text-transform: uppercase; font-weight: 500; margin-bottom: 4px;">
                                🔍 偵測到缺貨商品背景底價 (Item #${activeSku})
                            </div>
                            <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                                <span style="color: #888888; font-size: 14px; text-decoration: line-through;">原預估價: $${(priceInfo.price * 1.3).toFixed(2)}</span>
                                <strong style="color: #522555; font-size: 22px; font-weight: 800;">$${priceInfo.price} <span style="font-size: 13px; font-weight: 500;">${priceInfo.currency}</span></strong>
                            </div>
                            <div style="color: #b89753; font-size: 11px; font-weight: 600; margin-top: 3px; letter-spacing: 0.5px;">
                                ✨ 補貨後預計將以此背景價（或配合折扣碼）供您購買
                            </div>
                        `;

                        // 插入至 Notify Me 按鈕的前方（上方）
                        btn.parentNode.insertBefore(banner, btn);
                    }
                }
            }
        });
    }

    // 注入淡入動畫 CSS 樣式
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeInDown {
            from {
                opacity: 0;
                transform: translateY(-8px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
    `;
    document.head.appendChild(style);

    // 初始執行一次
    injectPrices();

    // 監聽 Next.js 頁面變更（因 SPA 機制，切換尺寸時只更新局部 DOM，故使用 MutationObserver 監聽）
    const observer = new MutationObserver(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            injectPrices();
        }, 150);
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();
