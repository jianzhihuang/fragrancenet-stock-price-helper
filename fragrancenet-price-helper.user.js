// ==UserScript==
// @name         FragranceNet 缺貨商品背景價格顯示器
// @namespace    http://tampermonkey.net/
// @version      1.9
// @description  在 FragranceNet 上針對任何缺貨的商品，自動解析背景 JSON-LD 結構化資料，並在「Notify Me」按鈕上方與商品編號旁顯示背景隱藏價格。
// @author       Antigravity
// @match        https://www.fragrancenet.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // 豪華樣式的 Console Log 標頭
    console.log(
        "%c🚀 [FragranceNet Helper v1.9] 油猴指令碼已載入並啟動雙模守護機制（Observer + Timer）！",
        "color: #ffffff; background: #522555; font-weight: bold; font-size: 13px; padding: 4px 10px; border-radius: 4px;"
    );

    // 儲存 SKU -> 價格與幣別資訊的對照表
    let skuPriceMap = {};
    let debounceTimer = null;

    // 解析 JSON-LD 結構化資料
    function parseJsonLd() {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        
        scripts.forEach((script, idx) => {
            try {
                const rawJson = script.textContent.trim();
                if (!rawJson || script.dataset.parsedByPriceHelper === rawJson) return;

                const data = JSON.parse(rawJson);
                script.dataset.parsedByPriceHelper = rawJson;
                console.log(`[LD-JSON 掃描] 成功讀取第 ${idx + 1} 個 JSON 對象:`, data);
                
                const pendingItems = Array.isArray(data) ? [...data] : [data];

                while (pendingItems.length > 0) {
                    const item = pendingItems.shift();
                    if (item && typeof item === 'object') {
                        const type = item['@type'];
                        const offers = item.offers;
                        const sku = item.sku || (offers && !Array.isArray(offers) && offers.sku);
                        
                        console.log(`[LD-JSON 節點] 偵測到類型: "${type}", SKU: "${sku}", 有 Offers: ${!!offers}`);

                        // 只要節點包含 offers 或 sku，即視為產品資訊（防止因網頁翻譯將 Product 類型字串翻譯成中文而配對失敗）
                        const isProduct = type === 'Product' || type === 'ProductGroup' || offers || sku || (Array.isArray(type) && (type.includes('Product') || type.includes('ProductGroup')));
                        
                        if (isProduct && offers) {
                            const offerList = Array.isArray(offers) ? offers : [offers];
                            offerList.forEach(offer => {
                                if (!offer || typeof offer !== 'object') return;
                                const finalSku = offer.sku || item.sku;
                                const price = offer.price;
                                const currency = offer.priceCurrency || 'USD';
                                if (finalSku && price !== undefined) {
                                    const cleanSku = String(finalSku).trim();
                                    skuPriceMap[cleanSku] = {
                                        price: parseFloat(price).toFixed(2),
                                        currency: currency
                                    };
                                    console.log(`%c[LD-JSON 解析成功] SKU: ${cleanSku} -> 售價: $${price} ${currency}`, "color: #b89753; font-weight: bold;");
                                }
                            });
                        }

                        ['hasVariant', 'variant', 'isVariantOf', '@graph', 'itemListElement'].forEach(key => {
                            const childItems = item[key];
                            if (Array.isArray(childItems)) {
                                pendingItems.push(...childItems);
                            } else if (childItems && typeof childItems === 'object') {
                                pendingItems.push(childItems);
                            }
                        });
                    }
                }
            } catch (e) {
                console.warn(`[FragranceNet Helper] 解析第 ${idx + 1} 個 JSON-LD 標籤失敗:`, e.message);
            }
        });
    }

    // 尋找當前頁面最深層包含關鍵字（支援中文翻譯與多格式）的元素及其對應的 SKU
    function findSkuElements() {
        const skuElements = [];
        const allElements = document.querySelectorAll('*');
        const ignoredTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'TEXTAREA', 'HEAD', 'HTML', 'META', 'LINK'];
        
        allElements.forEach(el => {
            if (ignoredTags.includes(el.tagName)) return;
            
            const text = el.textContent;
            // 匹配 English "Item" 與中文翻譯字詞（項目、商品、編號、编号）
            const hasKeyword = /(?:Item|項目|商品|編號|编号)/i.test(text);
            
            if (hasKeyword) {
                // 檢查其子元素是否也包含關鍵字，以定位到最深層葉子元素
                const hasChildWithText = Array.from(el.children).some(child => {
                    return !ignoredTags.includes(child.tagName) && /(?:Item|項目|商品|編號|编号)/i.test(child.textContent);
                });
                
                if (!hasChildWithText) {
                    // 匹配諸如 "Item #488007"、"商品編號: 488007"、"項目:488007"、"Item: 488007" 等多元格式
                    const match = text.match(/(?:Item|項目|商品|編號|编号)\s*[:：#]?\s*(\d{5,7})/i);
                    if (match) {
                        skuElements.push({
                            element: el,
                            sku: match[1].trim()
                        });
                    }
                }
            }
        });
        return skuElements;
    }

    // 優先用 Notify Me 按鈕附近容器的 Item #，避免多規格頁面誤抓第一個 SKU
    function getSkuNearButton(btn, skuElements) {
        let container = btn.parentNode;
        while (container && container !== document.documentElement) {
            const matched = skuElements.find(item => container.contains(item.element));
            if (matched) return matched.sku;
            container = container.parentNode;
        }
        return null;
    }

    // 執行價格注入邏輯
    function injectPrices() {
        // 印出簡單標記以在主控台確認掃描是否有被執行
        console.log("[FragranceNet Helper] 執行價格注入掃描 (Time: " + new Date().toLocaleTimeString() + ")");
        
        parseJsonLd();

        // 1. 在最深層的商品編號「Item #XXXXXX」旁注入精美小紫色標籤
        const skuElements = findSkuElements();
        
        skuElements.forEach(item => {
            const el = item.element;
            const sku = item.sku;
            
            // 檢查是否已存在注入標籤（防範 React 動態更新將子節點抹除）
            const existingBadge = el.querySelector('.fnet-injected-badge');
            if (!existingBadge) {
                const priceInfo = skuPriceMap[sku];
                if (priceInfo) {
                    console.log(`[UI 標籤注入] 正在為 SKU: ${sku} 注入小標籤...`);
                    const badge = document.createElement('span');
                    badge.className = 'fnet-injected-badge';
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
        });

        // 2. 在缺貨的「Notify me / When Available」按鈕上方，生成價格提示大看板
        const buttons = document.querySelectorAll('button');
        
        buttons.forEach(btn => {
            const btnText = btn.textContent.toLowerCase();
            const parentText = btn.parentNode ? btn.parentNode.textContent.toLowerCase() : '';
            const isSoldOutEmailForm = btnText.includes('submit') && parentText.includes('sold out') && parentText.includes('email');
            const hasNotifyText = btnText.includes('notify me') || btnText.includes('when available') || isSoldOutEmailForm;
            if (hasNotifyText) {
                // 檢查該按鈕的前一個兄弟元素是否已是看板（防範 React 動態更新抹除看板）
                const prevEl = btn.previousElementSibling;
                const hasBanner = prevEl && prevEl.classList.contains('fnet-injected-price-banner');
                
                if (!hasBanner) {
                    console.log("[UI 橫幅偵測] 發現缺貨按鈕，準備進行大橫幅注入...", btn);
                    // 抓取此按鈕當前關聯的 SKU 編號
                    const skuElements = findSkuElements();
                    const activeSkus = Array.from(new Set(skuElements.map(x => x.sku)));
                    console.log("[FragranceNet Helper] 目前頁面上已顯現的 SKU 編號:", activeSkus);
                    let activeSku = getSkuNearButton(btn, skuElements) || activeSkus[0];
                    if (!activeSku) {
                        const pricedSkus = Object.keys(skuPriceMap);
                        activeSku = pricedSkus.length === 1 ? pricedSkus[0] : null;
                    }
                    if (activeSku) {
                        const priceInfo = skuPriceMap[activeSku];

                        if (priceInfo) {
                            console.log(`%c[UI 橫幅注入成功] 正在 Notify Me 上方顯示背景底價: $${priceInfo.price}`, "color: #522555; font-weight: bold;");
                            // 刪除可能因 DOM 重新排序或更新而殘留的舊看板
                            const oldBanners = btn.parentNode.querySelectorAll('.fnet-injected-price-banner');
                            oldBanners.forEach(ob => ob.remove());

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
                                    🔍 偵測到缺貨商品歷史/背景售價 (Item #${activeSku})
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

    // 監聽網頁所有 DOM 變更，鎖定 document.documentElement (最上層根結點) 以確保絕不漏抓
    const observer = new MutationObserver(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            injectPrices();
        }, 150);
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    // 備用防線：設定 1.5 秒的定時輪詢，防止因 isolated context 或特定瀏覽器阻擋 MutationObserver 運作
    setInterval(injectPrices, 1500);
})();
