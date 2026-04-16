// ============================================================
// SneakerArb — Comparador de Preços StockX vs Droper
// ============================================================

(async function () {
    // Show loading
    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'loading-overlay';
    loadingOverlay.innerHTML = `
        <div class="loading-spinner"></div>
        <div class="loading-text">Carregando produtos...</div>
    `;
    document.body.appendChild(loadingOverlay);

    // ============ CONFIGURATION ============
    // Valor do dólar - iniciaremos com fallback e buscaremos via API
    let exchangeRate = 5.50; 

    // Função para buscar taxa de câmbio real
    async function fetchExchangeRate() {
        try {
            const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
            const data = await response.json();
            if (data && data.rates && data.rates.BRL) {
                console.log('Taxa de câmbio atualizada via API:', data.rates.BRL);
                return data.rates.BRL;
            }
        } catch (e) {
            console.error('Erro ao buscar taxa de câmbio, usando fallback:', e);
        }
        return 5.50; // Fallback se a API falhar
    }

    // Buscamos a taxa antes de processar
    exchangeRate = await fetchExchangeRate();

    // ============ FETCH DATA ============
    let stockxData = [];
    let droperData = [];

    try {
        const [stockxRes, droperRes] = await Promise.all([
            fetch('resultados_stockx.json'),
            fetch('drops_final.json') // Já com o nome correto do seu arquivo
        ]);
        stockxData = await stockxRes.json();
        droperData = await droperRes.json();
    } catch (e) {
        console.error('Erro ao carregar JSONs:', e);
    }

    console.log('Taxa de câmbio fixada: Dólar x5');
    console.log('StockX produtos:', stockxData.length);
    console.log('Droper produtos:', droperData.length);

    // ============ HELPERS ============
    function parseUSD(priceStr) {
        if (!priceStr) return 0;
        return parseFloat(priceStr.replace(/[$,]/g, '')) || 0;
    }

    function formatBRL(value) {
        if (value === null || value === undefined) return '—';
        return 'R$ ' + value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatUSD(value) {
        if (value === null || value === undefined) return '—';
        return '$ ' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // Upgrade StockX image URL to higher resolution
    function upgradeImageUrl(url) {
        if (!url) return '';
        // Replace small thumbnail params with larger ones
        return url
            .replace(/w=140/g, 'w=700')
            .replace(/h=75/g, 'h=500')
            .replace(/q=60/g, 'q=85')
            .replace(/dpr=1/g, 'dpr=2');
    }

    function normalizeForMatch(str) {
        return str
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
            .replace(/[^a-z0-9\s]/g, '') // remove special chars
            .replace(/\s+/g, ' ')
            .trim();
    }

    // ============ MATCHING ALGORITHM ============
    
    // Mapeamento dos meses em português da Droper para números
    const MONTH_MAP = {
        'jan': '01', 'fev': '02', 'mar': '03', 'abr': '04', 'mai': '05', 'jun': '06',
        'jul': '07', 'ago': '08', 'set': '09', 'out': '10', 'nov': '11', 'dez': '12'
    };

    // Converte a data da StockX (MM/DD/YYYY) para YYYY-MM-DD
    function parseStockxDate(dateStr) {
        if (!dateStr || !dateStr.includes('/')) return null;
        const p = dateStr.split('/');
        if (p.length !== 3) return null;
        return `${p[2]}-${p[0].padStart(2, '0')}-${p[1].padStart(2, '0')}`;
    }

    // Converte a data da Droper (DD/MMM/YYYY) para YYYY-MM-DD
    function parseDroperDate(dateStr) {
        if (!dateStr || !dateStr.includes('/')) return null;
        const p = dateStr.split('/');
        if (p.length !== 3) return null;
        const month = MONTH_MAP[p[1].toLowerCase()] || '00';
        return `${p[2]}-${month}-${p[0].padStart(2, '0')}`;
    }

    const STRIP_WORDS = new Set(['x', 'retro', 'og', 'se', 'qs', 'wmns', 'gs', 'ps', 'td', 'box', 'special', 'edition']);
    const COMMON_WORDS = new Set(['nike', 'adidas', 'air', 'jordan', 'high', 'mid', 'low', 'sb', 'dunk', 'yeezy', 'boost', '1', '2', '3', '4', '5', '11']);

    function getWordsArray(name) {
        return normalizeForMatch(name)
            .replace(/\b20[1-2][0-9]\b/g, '') // remove anos soltos do nome
            .replace(/&/g, '')
            .split(' ')
            .filter(w => w.length > 0 && !STRIP_WORDS.has(w));
    }

    function matchProducts(stockx, droper) {
        const results = [];

        const cleanDroper = droper.filter(d => {
            const lower = d.nome.toLowerCase();
            return !lower.includes('chaveiro') && !lower.startsWith('pack ');
        });

        // Pré-processa as palavras e a DATA NORMALIZADA da Droper
        const droperItems = cleanDroper.map(dp => ({
            ...dp,
            words: getWordsArray(dp.nome),
            normDate: parseDroperDate(dp.data_lancamento)
        }));

        const usedDroperIndices = new Set();

        for (const sx of stockx) {
            const sxWords = getWordsArray(sx.nome);
            if (sxWords.length === 0) continue;

            const sxDate = parseStockxDate(sx.data_lancamento);
            let sxWeightTotal = 0;
            for (const w of sxWords) sxWeightTotal += COMMON_WORDS.has(w) ? 1 : 3;

            let bestMatch = null;
            let highestScore = 0;
            let bestIndex = -1;

            for (let i = 0; i < droperItems.length; i++) {
                if (usedDroperIndices.has(i)) continue;

                const dpWords = droperItems[i].words;
                const dpDate = droperItems[i].normDate;
                
                // --- 1. CÁLCULO PELO NOME ---
                let dpWeightTotal = 0;
                for (const w of dpWords) dpWeightTotal += COMMON_WORDS.has(w) ? 1 : 3;

                let matchWeight = 0;
                for (const w of sxWords) {
                    if (dpWords.includes(w)) matchWeight += COMMON_WORDS.has(w) ? 1 : 3;
                }
                const wordScore = (2 * matchWeight) / (sxWeightTotal + dpWeightTotal);

                // --- 2. CÁLCULO PELA DATA (FLEXÍVEL) ---
                let dateBonus = 0;
                if (sxDate && dpDate) {
                    if (sxDate === dpDate) {
                        dateBonus = 0.2;  // Bônus se a data for idêntica
                    } else {
                        const sxYear = sxDate.substring(0, 4);
                        const dpYear = dpDate.substring(0, 4);
                        if (sxYear === dpYear) {
                            dateBonus = 0.1; // Pequeno bônus se pelo menos o ano coincidir
                        }
                        // Se anos forem diferentes, não aplicamos punição fatal. 
                        // O peso do nome decidirá o match.
                    }
                }

                // Soma a inteligência do Nome com a Inteligência da Data
                const finalScore = wordScore + dateBonus;

                if (finalScore > highestScore || (finalScore === highestScore && highestScore > 0 && droperItems[i].preco < (bestMatch ? bestMatch.preco : Infinity))) {
                    highestScore = finalScore;
                    bestMatch = droperItems[i];
                    bestIndex = i;
                }
            }

            // SCORE DE CORTE (70% de semelhança mínima - baixamos levemente para ser mais flexível)
            if (highestScore > 0.70) {
                usedDroperIndices.add(bestIndex);

                const dp = bestMatch;
                const stockxUSD = parseUSD(sx.preco);
                const stockxBRL = stockxUSD * exchangeRate;
                const droperBRL = dp.preco;
                const diffBRL = droperBRL - stockxBRL;
                const diffPct = stockxBRL > 0 ? ((diffBRL / stockxBRL) * 100) : 0;

                // --- LÓGICA DE IMAGEM ---
                // Verifica se a imagem da StockX é placeholder ou inválida
                const sxImage = upgradeImageUrl(sx.imagem);
                const isSxPlaceholder = !sxImage || 
                                        sxImage.includes('Product-Placeholder-Default') || 
                                        sxImage.includes('placeholder');
                
                let imagem = sxImage;
                let hasRealImage = !isSxPlaceholder;

                // Se StockX não tem foto, tentamos pegar da Droper (Imagem ou Ícone)
                if (isSxPlaceholder) {
                    if (dp.imagem) {
                        imagem = dp.imagem;
                        hasRealImage = true;
                    } else if (dp.icone) {
                        imagem = dp.icone;
                        hasRealImage = true;
                    }
                }

                const droperLink = dp.link || dp.url || null;

                results.push({
                    nome: sx.nome,
                    nomeDroper: dp.nome,
                    imagem: imagem || '',
                    droperImage: dp.imagem || '',
                    droperIcon: dp.icone || '',
                    hasRealImage: hasRealImage,
                    stockxUSD: stockxUSD,
                    stockxBRL: stockxBRL,
                    droperBRL: droperBRL,
                    diffBRL: diffBRL,
                    diffPct: diffPct,
                    stockxLink: sx.link,
                    droperLink: droperLink,
                    cheaperAt: stockxBRL <= droperBRL ? 'stockx' : 'droper',
                    matchScore: highestScore
                });
            }
        }

        console.log(`Matched ${results.length} products (Weighted Name + Date Check)`);
        return results;
    }
    
    // ============ IMAGE ERROR HANDLER ============
    window.handleImageError = function(img, imageFallback, iconFallback, placeholder) {
        // 1. Tenta Imagem da Droper
        if (imageFallback && img.src !== imageFallback && !img.dataset.triedImage) {
            img.dataset.triedImage = "true";
            console.log('StockX image failed, trying Droper image fallback:', imageFallback);
            img.src = imageFallback;
            return;
        }
        // 2. Tenta Ícone da Droper
        if (iconFallback && img.src !== iconFallback && !img.dataset.triedIcon) {
            img.dataset.triedIcon = "true";
            console.log('Droper image failed, trying Droper icon fallback:', iconFallback);
            img.src = iconFallback;
            return;
        }
        // 3. Usa Placeholder SVG
        if (img.src !== placeholder) {
            img.src = placeholder;
            img.closest('.card-image').classList.add('no-photo');
        }
        img.onerror = null; // Evita loop infinito
    };

    // ============ MATCH ============
    let allProducts = matchProducts(stockxData, droperData);

    // ============ UPDATE STATS ============
    function updateStats(products) {
        document.getElementById('total-matches').textContent = products.length;

        if (products.length > 0) {
            const avgDiff = products.reduce((sum, p) => sum + Math.abs(p.diffBRL), 0) / products.length;
            document.getElementById('avg-diff').textContent = formatBRL(avgDiff);

            const bestDeal = products.reduce((best, p) => Math.abs(p.diffBRL) > Math.abs(best.diffBRL) ? p : best, products[0]);
            document.getElementById('best-deal').textContent = formatBRL(Math.abs(bestDeal.diffBRL));
        } else {
            document.getElementById('avg-diff').textContent = 'R$ 0';
            document.getElementById('best-deal').textContent = '—';
        }
    }

    // ============ RENDER ============
    const PLACEHOLDER_IMG = 'data:image/svg+xml,' + encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="280" height="140" viewBox="0 0 280 140">
            <rect fill="#1a1a2e" width="280" height="140"/>
            <text x="140" y="65" text-anchor="middle" fill="#6c5ce7" font-family="Arial" font-size="14" font-weight="bold">Sem Imagem</text>
            <text x="140" y="85" text-anchor="middle" fill="#555570" font-family="Arial" font-size="11">StockX</text>
        </svg>
    `);

    function renderProducts(products) {
        const container = document.getElementById('grid-container');
        const emptyState = document.getElementById('empty-state');

        if (products.length === 0) {
            container.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';

        container.innerHTML = products.map((p, i) => {
            const isStockxCheaper = p.cheaperAt === 'stockx';
            const diffClass = p.diffBRL > 50 ? 'positive' : p.diffBRL < -50 ? 'negative' : 'neutral';
            const diffLabel = isStockxCheaper ? 'StockX mais barato' : 'Droper mais barato';
            const cheaperClass = isStockxCheaper ? 'stockx' : 'droper';

            // Use the image from matching (already falls back to Droper photo)
            const hasImage = p.hasRealImage;
            const imgSrc = hasImage ? p.imagem : PLACEHOLDER_IMG;

            // Cria o link de busca usando o nome original do tênis na StockX
            const droperSearchUrl = `https://droper.app/buscar/${encodeURIComponent(p.nome)}`;

            const droperLinkHtml = p.droperLink
                ? `<a href="${p.droperLink}" target="_blank" rel="noopener noreferrer" class="card-link droper-link" id="droper-link-${i}">
                     🇧🇷 Droper
                   </a>`
                : `<a href="${droperSearchUrl}" target="_blank" rel="noopener noreferrer" class="card-link droper-link" id="droper-link-${i}">
                     🔍 Buscar Droper
                   </a>`;

            return `
                <div class="product-card" style="animation-delay: ${Math.min(i * 0.03, 0.5)}s" id="product-card-${i}">
                    <div class="card-image${!hasImage ? ' no-photo' : ''}">
                        <img src="${imgSrc}" alt="${p.nome}" loading="lazy" 
                             onerror="handleImageError(this, '${p.droperImage}', '${p.droperIcon}', '${PLACEHOLDER_IMG}')">
                        <span class="cheaper-badge ${cheaperClass}">${isStockxCheaper ? '🟢 StockX' : '🟠 Droper'}</span>
                        <span class="diff-badge">${Math.abs(p.diffPct).toFixed(0)}%</span>
                    </div>
                    <div class="card-body">
                        <div class="card-name" title="${p.nome}">${p.nome}</div>
                        <div class="card-name-droper" title="${p.nomeDroper}">Droper: ${p.nomeDroper}</div>
                        <div class="prices-row">
                            <div class="price-box ${isStockxCheaper ? 'winner' : ''}">
                                <div class="price-source">StockX 🇺🇸</div>
                                <div class="price-value">${formatBRL(p.stockxBRL)}</div>
                                <div class="price-original">${formatUSD(p.stockxUSD)} USD</div>
                            </div>
                            <div class="price-box ${!isStockxCheaper ? 'winner' : ''}">
                                <div class="price-source">Droper 🇧🇷</div>
                                <div class="price-value">${formatBRL(p.droperBRL)}</div>
                            </div>
                        </div>
                        <div class="diff-row ${diffClass}">
                            <span class="diff-label">${diffLabel}</span>
                            <span class="diff-amount">${formatBRL(Math.abs(p.diffBRL))}</span>
                        </div>
                        <div class="card-links">
                            <a href="${p.stockxLink}" target="_blank" rel="noopener noreferrer" class="card-link stockx-link" id="stockx-link-${i}">
                                🌍 StockX
                            </a>
                            ${droperLinkHtml}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        updateStats(products);
    }

    // ============ SORTING & FILTERING ============
    let currentSort = 'diff-desc';
    let currentSource = 'all';
    let currentSearch = '';

    function sortProducts(products, sortKey) {
        const sorted = [...products];
        switch (sortKey) {
            case 'diff-desc':
                sorted.sort((a, b) => Math.abs(b.diffBRL) - Math.abs(a.diffBRL));
                break;
            case 'diff-asc':
                sorted.sort((a, b) => Math.abs(a.diffBRL) - Math.abs(b.diffBRL));
                break;
            case 'price-desc':
                sorted.sort((a, b) => Math.max(b.stockxBRL, b.droperBRL) - Math.max(a.stockxBRL, a.droperBRL));
                break;
            case 'price-asc':
                sorted.sort((a, b) => Math.min(a.stockxBRL, a.droperBRL) - Math.min(b.stockxBRL, b.droperBRL));
                break;
            case 'pct-desc':
                sorted.sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));
                break;
            case 'name-asc':
                sorted.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
                break;
        }
        return sorted;
    }

    function filterProducts() {
        let filtered = [...allProducts];

        // Source filter
        if (currentSource === 'stockx') {
            filtered = filtered.filter(p => p.cheaperAt === 'stockx');
        } else if (currentSource === 'droper') {
            filtered = filtered.filter(p => p.cheaperAt === 'droper');
        }

        // Search filter
        if (currentSearch) {
            const q = normalizeForMatch(currentSearch);
            filtered = filtered.filter(p => normalizeForMatch(p.nome).includes(q) || normalizeForMatch(p.nomeDroper).includes(q));
        }

        // Sort
        filtered = sortProducts(filtered, currentSort);

        renderProducts(filtered);
    }

    // ============ EVENT LISTENERS ============

    // Sort buttons
    document.getElementById('sort-buttons').addEventListener('click', (e) => {
        const btn = e.target.closest('.sort-btn');
        if (!btn) return;
        document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentSort = btn.dataset.sort;
        filterProducts();
    });

    // Source filter
    document.getElementById('source-filter').addEventListener('click', (e) => {
        const btn = e.target.closest('.source-btn');
        if (!btn) return;
        document.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentSource = btn.dataset.source;
        filterProducts();
    });

    // Search
    let searchTimeout;
    document.getElementById('search-input').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentSearch = e.target.value;
            filterProducts();
        }, 200);
    });

    // ============ INITIAL RENDER ============
    filterProducts();

    // Remove loading
    setTimeout(() => {
        loadingOverlay.classList.add('fade-out');
        setTimeout(() => loadingOverlay.remove(), 500);
        
        // Atualiza nota no rodapé com o câmbio atual
        const footer = document.querySelector('#main-footer p');
        if (footer) {
            footer.innerHTML = `SneakerArb — Dados de StockX (USD) e Droper (BRL) • Câmbio atual: <strong>1 USD = R$ ${exchangeRate.toFixed(2)}</strong>`;
        }
    }, 300);
})();
