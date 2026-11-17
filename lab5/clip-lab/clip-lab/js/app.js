/**
 * ============================================================
 * app.js — Главное приложение
 * Управление UI, рендеринг, взаимодействие пользователя
 * ============================================================
 */

(function () {
    'use strict';

    const { EPS, INF, Point, Rect, Line, Polygon,
            pointInPolygon, segmentIntersection } = window.Geo;
    const { sutherlandCohen, liangBarsky, midpointSubdivision,
            cyrusBeck, weilerAtherton, greinerHormann,
            OpCounter, resetCounter, getCounter } = window.ClipAlgo;
    const { AABB, SpatialIndex } = window.Spatial;

    let spatialIndex = new SpatialIndex('none');

    // ═════════════════════════════════════════════════════════
    //  ГЛОБАЛЬНОЕ СОСТОЯНИЕ
    // ═════════════════════════════════════════════════════════

    const state = {
        lines: [],          // Массив Line
        polygons: [],       // Массив Polygon
        window: new Rect(100, 100, 400, 400),
        algo: 'cohen',      // Алгоритм отрезков
        polyAlgo: 'weiler', // Алгоритм полигонов
        spatial: 'none',    // Тип пространственного индекса
        tool: 'pan',        // Текущий инструмент
        selectedLine: null,
        selectedPoly: null,
        nextId: 1,
        offset: new Point(0, 0),  // Смещение камеры
        scale: 1,                // Масштаб
        isDragging: false,
        dragStart: null,
        dragMode: null,
        showAABB: true,
        showGrid: true,
        results: [],
        log: [],
        fps: 60,
        frameTimes: [],
        clipStats: { mul: 0, div: 0, add: 0, sub: 0, cmp: 0, time: 0 }
    };

    // ═════════════════════════════════════════════════════════
    //  DOM ЭЛЕМЕНТЫ
    // ═════════════════════════════════════════════════════════

    const canvas = document.getElementById('main-canvas');
    const ctx = canvas.getContext('2d');
    const $ = (id) => document.getElementById(id);

    // ═════════════════════════════════════════════════════════
    //  УТИЛИТЫ
    // ═════════════════════════════════════════════════════════

    function log(msg, type = 'info') {
        const entry = { msg, type, time: new Date().toLocaleTimeString() };
        state.log.unshift(entry);
        if (state.log.length > 100) state.log.pop();
        renderLog();
    }

    function screenToWorld(sx, sy) {
        const rect = canvas.getBoundingClientRect();
        const x = (sx - rect.left - canvas.width / 2) / state.scale + state.offset.x;
        const y = (sy - rect.top - canvas.height / 2) / state.scale + state.offset.y;
        return new Point(x, y);
    }

    function worldToScreen(p) {
        return new Point(
            (p.x - state.offset.x) * state.scale + canvas.width / 2,
            (p.y - state.offset.y) * state.scale + canvas.height / 2
        );
    }

    // ═════════════════════════════════════════════════════════
    //  РЕНДЕРИНГ
    // ═════════════════════════════════════════════════════════

    function resizeCanvas() {
        const container = $('canvas-container');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = container.clientWidth * dpr;
        canvas.height = container.clientHeight * dpr;
        canvas.style.width = container.clientWidth + 'px';
        canvas.style.height = container.clientHeight + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        canvas._dpr = dpr;
    }

    function render() {
        const dpr = canvas._dpr || 1;
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;
        ctx.clearRect(0, 0, w, h);

        // Фон
        ctx.fillStyle = '#0f3460';
        ctx.fillRect(0, 0, w, h);

        // Сетка координат
        if (state.showGrid) drawGrid(w, h);

        // Оси координат
        drawAxes(w, h);

        // AABB пре-фильтры
        if (state.showAABB && spatialIndex) {
            drawAABBs();
        }

        // Полигоны
        for (const poly of state.polygons) {
            drawPolygon(poly, false);
        }

        // Отсекающее окно
        drawWindow();

        // Отрезки
        for (const line of state.lines) {
            drawLine(line, false);
        }

        // Результаты отсечения
        drawClippedResults();

        // Временный отрезок при рисовании
        if (state.drawingLine) {
            drawLine(state.drawingLine, false, '#ff9800');
        }

        // Временный полигон
        if (state.drawingPoly) {
            drawTempPolygon(state.drawingPoly);
        }
    }

    function drawGrid(w, h) {
        ctx.strokeStyle = 'rgba(30, 58, 95, 0.5)';
        ctx.lineWidth = 1;

        const center = worldToScreen(new Point(0, 0));
        const gridSize = 50 * state.scale;

        // Вертикальные линии
        let startX = center.x % gridSize;
        for (let x = startX; x < w; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }

        // Горизонтальные линии
        let startY = center.y % gridSize;
        for (let y = startY; y < h; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }
    }

    function drawAxes(w, h) {
        ctx.strokeStyle = 'rgba(100, 180, 255, 0.4)';
        ctx.lineWidth = 1.5;

        const center = worldToScreen(new Point(0, 0));

        // X ось
        ctx.beginPath();
        ctx.moveTo(0, center.y);
        ctx.lineTo(w, center.y);
        ctx.stroke();

        // Y ось
        ctx.beginPath();
        ctx.moveTo(center.x, 0);
        ctx.lineTo(center.x, h);
        ctx.stroke();

        // Стрелки и подписи
        ctx.fillStyle = 'rgba(100, 180, 255, 0.6)';
        ctx.font = '11px monospace';
        ctx.fillText('X', w - 15, center.y - 5);
        ctx.fillText('Y', center.x + 5, 15);
        ctx.fillText('O', center.x + 5, center.y + 12);
    }

    function drawWindow() {
        const w = state.window;
        const tl = worldToScreen(new Point(w.xmin, w.ymax));
        const tr = worldToScreen(new Point(w.xmax, w.ymax));
        const bl = worldToScreen(new Point(w.xmin, w.ymin));
        const br = worldToScreen(new Point(w.xmax, w.ymin));

        const rw = br.x - bl.x;
        const rh = bl.y - tl.y;

        // Заливка
        ctx.fillStyle = 'rgba(255, 213, 79, 0.08)';
        ctx.fillRect(tl.x, tl.y, rw, rh);

        // Рамка
        ctx.strokeStyle = '#ffd54f';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);
        ctx.strokeRect(tl.x, tl.y, rw, rh);
        ctx.setLineDash([]);

        // Подпись
        ctx.fillStyle = '#ffd54f';
        ctx.font = '11px monospace';
        ctx.fillText(`[${w.xmin.toFixed(0)}, ${w.ymin.toFixed(0)}] × [${w.xmax.toFixed(0)}, ${w.ymax.toFixed(0)}]`,
                     tl.x + 5, tl.y + 14);
    }

    function drawLine(line, isClipped = false, color = null) {
        const p1 = worldToScreen(line.p1);
        const p2 = worldToScreen(line.p2);

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);

        if (isClipped) {
            ctx.strokeStyle = color || '#69f0ae';
            ctx.lineWidth = 3;
        } else {
            ctx.strokeStyle = color || line.color || '#4fc3f7';
            ctx.lineWidth = 1.5;
        }
        ctx.stroke();

        // Маркеры концов
        if (!isClipped) {
            ctx.fillStyle = ctx.strokeStyle;
            ctx.beginPath();
            ctx.arc(p1.x, p1.y, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(p2.x, p2.y, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        // ID отрезка
        if (!isClipped && line.id !== null) {
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = '10px monospace';
            const mid = new Point((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
            ctx.fillText(`#${line.id}`, mid.x + 5, mid.y - 5);
        }
    }

    function drawClippedResults() {
        for (const result of state.results) {
            if (result.type === 'line' && result.clipped) {
                const cl = result.clipped;
                const p1 = worldToScreen(cl.p1);
                const p2 = worldToScreen(cl.p2);
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.strokeStyle = '#69f0ae';
                ctx.lineWidth = 3;
                ctx.stroke();

                // Светящийся эффект
                ctx.strokeStyle = 'rgba(105, 240, 174, 0.3)';
                ctx.lineWidth = 6;
                ctx.stroke();
            }
        }

        // Результаты полигонов
        for (const result of state.polyResults || []) {
            for (const poly of result.polygons) {
                drawPolygon(poly, true);
            }
        }
    }

    function drawPolygon(poly, isClipped) {
        if (poly.size < 2) return;

        const points = poly.vertices.map(v => worldToScreen(v));

        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        if (poly.size > 2) ctx.closePath();

        if (isClipped) {
            ctx.fillStyle = 'rgba(105, 240, 174, 0.2)';
            ctx.fill();
            ctx.strokeStyle = '#69f0ae';
            ctx.lineWidth = 3;
            ctx.stroke();
            // Свечение
            ctx.strokeStyle = 'rgba(105, 240, 174, 0.3)';
            ctx.lineWidth = 6;
            ctx.stroke();
        } else {
            ctx.fillStyle = 'rgba(206, 147, 216, 0.1)';
            ctx.fill();
            ctx.strokeStyle = poly.color || '#ce93d8';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // Вершины
        ctx.fillStyle = isClipped ? '#69f0ae' : (poly.color || '#ce93d8');
        for (const p of points) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawTempPolygon(points) {
        if (points.length === 0) return;
        const screenPts = points.map(p => worldToScreen(p));

        ctx.beginPath();
        ctx.moveTo(screenPts[0].x, screenPts[0].y);
        for (let i = 1; i < screenPts.length; i++) {
            ctx.lineTo(screenPts[i].x, screenPts[i].y);
        }
        ctx.strokeStyle = '#ff9800';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);

        for (const p of screenPts) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#ff9800';
            ctx.fill();
        }
    }

    function drawAABBs() {
        if (spatialIndex.type === 'aabb' || spatialIndex.type === 'quadtree') {
            const boxes = spatialIndex.getAABBs();
            ctx.strokeStyle = 'rgba(255, 138, 101, 0.3)';
            ctx.lineWidth = 1;
            for (const box of boxes) {
                const tl = worldToScreen(new Point(box.xmin, box.ymax));
                const rw = (box.xmax - box.xmin) * state.scale;
                const rh = (box.ymax - box.ymin) * state.scale;
                ctx.strokeRect(tl.x, tl.y, rw, rh);
            }
        }

        if (spatialIndex.type === 'quadtree') {
            const nodes = spatialIndex.getQuadtreeNodeBounds();
            ctx.strokeStyle = 'rgba(255, 235, 59, 0.15)';
            ctx.lineWidth = 0.5;
            for (const box of nodes) {
                const tl = worldToScreen(new Point(box.xmin, box.ymax));
                const rw = (box.xmax - box.xmin) * state.scale;
                const rh = (box.ymax - box.ymin) * state.scale;
                ctx.strokeRect(tl.x, tl.y, rw, rh);
            }
        }
    }

    // ═════════════════════════════════════════════════════════
    //  АЛГОРИТМЫ ОТСЕЧЕНИЯ — ЗАПУСК
    // ═════════════════════════════════════════════════════════

    function performClipping() {
        resetCounter();
        const startTime = performance.now();
        state.results = [];
        state.polyResults = [];

        // Отсечение отрезков
        let linesToClip = state.lines;

        // Пространственная индексация
        if (state.spatial !== 'none') {
            const queryResult = spatialIndex.query(state.window);
            if (queryResult.ids !== null) {
                linesToClip = state.lines.filter(l => queryResult.ids.includes(l.id));
            }
            state.lastQueryTime = queryResult.time;
            state.lastCandidates = queryResult.candidates;
        }

        for (const line of linesToClip) {
            let clipped = null;
            switch (state.algo) {
                case 'cohen':
                    clipped = sutherlandCohen(line, state.window);
                    break;
                case 'liang':
                    clipped = liangBarsky(line, state.window);
                    break;
                case 'midpoint':
                    clipped = midpointSubdivision(line, state.window);
                    if (clipped && clipped.length > 0) {
                        clipped = clipped[0]; // Берём первый для отображения
                    } else {
                        clipped = null;
                    }
                    break;
                case 'cyrus':
                    // Преобразуем окно в полигон
                    const winPoly = new Polygon(state.window.vertices());
                    clipped = cyrusBeck(line, winPoly);
                    break;
            }

            if (clipped) {
                state.results.push({ type: 'line', original: line, clipped });
            }
        }

        // Отсечение полигонов
        for (const poly of state.polygons) {
            let result = [];
            const winPoly = new Polygon(state.window.vertices());

            if (state.polyAlgo === 'weiler') {
                result = weilerAtherton(poly, winPoly);
            } else {
                result = greinerHormann(poly, winPoly);
            }

            if (result.length > 0) {
                state.polyResults.push({ type: 'poly', original: poly, polygons: result });
            }
        }

        const elapsed = performance.now() - startTime;
        state.clipStats.time = elapsed;
        const cnt = getCounter();

        state.clipStats = {
            ...state.clipStats,
            mul: cnt.mul,
            div: cnt.div,
            add: cnt.add,
            sub: cnt.sub,
            cmp: cnt.cmp
        };

        log(`Отсечение выполнено за ${elapsed.toFixed(2)} мс. Видимых отрезков: ${state.results.length}, полигонов: ${state.polyResults.length}`, 'success');

        renderResults();
        updateStatusBar();
    }

    // ═════════════════════════════════════════════════════════
    //  ЗАГРУЗКА ДАННЫХ
    // ═════════════════════════════════════════════════════════

    function loadFromFile(content) {
        const lines = content.trim().split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        try {
            let idx = 0;
            const n = parseInt(lines[idx++]);

            state.lines = [];
            for (let i = 0; i < n; i++) {
                const coords = lines[idx++].split(/\s+/).map(Number);
                if (coords.length === 4) {
                    const line = new Line(coords[0], coords[1], coords[2], coords[3], state.nextId++);
                    state.lines.push(line);
                }
            }

            if (idx < lines.length) {
                const winCoords = lines[idx].split(/\s+/).map(Number);
                if (winCoords.length === 4) {
                    state.window = new Rect(winCoords[0], winCoords[1], winCoords[2], winCoords[3]);
                }
            }

            log(`Загружено ${state.lines.length} отрезков из файла`, 'success');
            renderLineList();
            updateWindowInfo();
        } catch (e) {
            log(`Ошибка парсинга файла: ${e.message}`, 'error');
        }
    }

    function loadDemoData() {
        state.lines = [
            // Обычные отрезки
            new Line(50, 150, 350, 350, state.nextId++),   // Пересекает окно
            new Line(200, 50, 300, 450, state.nextId++),   // Пересекает вертикально
            new Line(0, 250, 500, 250, state.nextId++),    // Горизонтальная через центр
            new Line(250, 0, 250, 500, state.nextId++),    // Вертикальная через центр
            new Line(50, 50, 150, 150, state.nextId++),    // Полностью внутри
            new Line(450, 450, 550, 550, state.nextId++),  // Полностью снаружи
            new Line(100, 100, 200, 300, state.nextId++),  // Внутри
            new Line(300, 100, 450, 200, state.nextId++),  // Пересекает правую границу
            // На границах
            new Line(100, 100, 400, 100, state.nextId++),  // На нижней границе (ymin=100)
            new Line(100, 400, 400, 400, state.nextId++),  // На верхней границе (ymax=400)
            new Line(100, 150, 100, 350, state.nextId++),  // На левой границе (xmin=100)
            // Нулевой отрезок (точка)
            new Line(150, 200, 150, 200, state.nextId++),  // Точка внутри
            new Line(100, 100, 100, 100, state.nextId++),  // Точка на вершине окна
            // Диагональ через вершину
            new Line(0, 0, 500, 500, state.nextId++),      // Через угол окна
        ];

        state.window = new Rect(100, 100, 400, 400);

        state.polygons = [
            // Выпуклый
            new Polygon([
                new Point(50, 50), new Point(300, 80),
                new Point(350, 300), new Point(200, 450), new Point(80, 350)
            ], state.nextId++),
            // Вогнутый (L-образный)
            new Polygon([
                new Point(150, 150), new Point(380, 150),
                new Point(380, 250), new Point(280, 250),
                new Point(280, 380), new Point(150, 380)
            ], state.nextId++),
            // Самопересекающийся (звезда)
            new Polygon([
                new Point(250, 50), new Point(280, 180),
                new Point(400, 200), new Point(300, 280),
                new Point(330, 420), new Point(250, 330),
                new Point(170, 420), new Point(200, 280),
                new Point(100, 200), new Point(220, 180)
            ], state.nextId++)
        ];

        log('Загружены демо-данные (включая вырожденные случаи)', 'success');
        renderLineList();
        renderPolyList();
        updateWindowInfo();
    }

    function generateBigData(count = 500000) {
        log(`Генерация ${count} отрезков...`, 'info');
        const startTime = performance.now();

        state.lines = [];
        // Генерируем вокруг окна
        const cx = 250, cy = 250;
        const spread = 1000;

        for (let i = 0; i < count; i++) {
            const x1 = cx + (Math.random() - 0.5) * spread;
            const y1 = cy + (Math.random() - 0.5) * spread;
            const len = Math.random() * 200;
            const angle = Math.random() * Math.PI * 2;
            const x2 = x1 + len * Math.cos(angle);
            const y2 = y1 + len * Math.sin(angle);

            state.lines.push(new Line(x1, y1, x2, y2, i));
        }

        const genTime = performance.now() - startTime;
        log(`Сгенерировано ${count} отрезков за ${genTime.toFixed(0)} мс`, 'success');

        // Строим пространственный индекс
        if (state.spatial === 'quadtree' || state.spatial === 'aabb') {
            const buildResult = spatialIndex.build(state.lines);
            log(`Построен индекс (${state.spatial}): ${buildResult.nodes} узлов за ${buildResult.buildTime.toFixed(1)} мс`, 'success');
        }

        renderLineList();
        updateStatusBar();
    }

    // ═════════════════════════════════════════════════════════
    //  ОБНОВЛЕНИЕ UI
    // ═════════════════════════════════════════════════════════

    function renderLineList() {
        const list = $('lines-list');
        $('lines-count').textContent = `${state.lines.length} отрезков`;

        // Показываем только первые 100 для производительности
        const display = state.lines.slice(0, 100);
        list.innerHTML = display.map(l => `
            <div class="line-item ${state.selectedLine === l.id ? 'selected' : ''}" data-id="${l.id}">
                <div class="line-item-left">
                    <span class="line-color-dot" style="background:${l.color || '#4fc3f7'}"></span>
                    <span>${l.id}: (${l.p1.x.toFixed(0)},${l.p1.y.toFixed(0)})→(${l.p2.x.toFixed(0)},${l.p2.y.toFixed(0)})</span>
                </div>
                <button class="delete-btn" data-del-line="${l.id}">×</button>
            </div>
        `).join('');

        if (state.lines.length > 100) {
            list.innerHTML += `<p class="hint">... и ещё ${state.lines.length - 100} отрезков</p>`;
        }

        // Обработчики
        list.querySelectorAll('.line-item').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.classList.contains('delete-btn')) return;
                const id = parseInt(el.dataset.id);
                state.selectedLine = id;
                renderLineList();
            });
        });

        list.querySelectorAll('[data-del-line]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(btn.dataset.delLine);
                state.lines = state.lines.filter(l => l.id !== id);
                spatialIndex.aabb.removeLine(id);
                renderLineList();
            });
        });
    }

    function renderPolyList() {
        const list = $('poly-list');
        $('poly-count').textContent = `${state.polygons.length} полигонов`;

        list.innerHTML = state.polygons.map(p => `
            <div class="poly-item ${state.selectedPoly === p.id ? 'selected' : ''}" data-poly-id="${p.id}">
                <div class="line-item-left">
                    <span class="line-color-dot" style="background:${p.color || '#ce93d8'}"></span>
                    <span>${p.id}: ${p.size} верш.</span>
                </div>
                <button class="delete-btn" data-del-poly="${p.id}">×</button>
            </div>
        `).join('');

        list.querySelectorAll('.poly-item').forEach(el => {
            el.addEventListener('click', () => {
                state.selectedPoly = parseInt(el.dataset.polyId);
                renderPolyList();
            });
        });

        list.querySelectorAll('[data-del-poly]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(btn.dataset.delPoly);
                state.polygons = state.polygons.filter(p => p.id !== id);
                renderPolyList();
            });
        });
    }

    function renderResults() {
        const container = $('results-content');
        let html = '';

        if (state.results.length === 0 && (!state.polyResults || state.polyResults.length === 0)) {
            html = '<p class="hint">Нет видимых частей после отсечения</p>';
        }

        // Отрезки
        const visibleLines = state.results.filter(r => r.type === 'line');
        if (visibleLines.length > 0) {
            html += `<h4 style="color:#69f0ae;margin:8px 0">Отрезки (${visibleLines.length})</h4>`;
            visibleLines.slice(0, 10).forEach(r => {
                html += `<div class="result-item">
                    <h4>#${r.original.id}</h4>
                    <pre>(${r.clipped.p1.x.toFixed(2)}, ${r.clipped.p1.y.toFixed(2)}) →
(${r.clipped.p2.x.toFixed(2)}, ${r.clipped.p2.y.toFixed(2)})</pre>
                </div>`;
            });
            if (visibleLines.length > 10) {
                html += `<p class="hint">... и ещё ${visibleLines.length - 10}</p>`;
            }
        }

        // Полигоны
        if (state.polyResults && state.polyResults.length > 0) {
            html += `<h4 style="color:#69f0ae;margin:8px 0">Полигоны (${state.polyResults.length})</h4>`;
            state.polyResults.forEach(r => {
                html += `<div class="result-item">
                    <h4>Исходный #${r.original.id} → ${r.polygons.length} частей</h4>
                    ${r.polygons.map((p, i) => `<pre>Часть ${i + 1}: ${p.vertices.length} верш.</pre>`).join('')}
                </div>`;
            });
        }

        // Статистика операций
        html += `<div class="result-item" style="margin-top:12px;border-color:#e94560">
            <h4>Статистика</h4>
            <pre>Алгоритм: ${getAlgoName(state.algo)}
Время: ${state.clipStats.time.toFixed(3)} мс
Умножений: ${state.clipStats.mul}
Делений: ${state.clipStats.div}
Сложений: ${state.clipStats.add}
Сравнений: ${state.clipStats.cmp}
Всего оп: ${(state.clipStats.mul + state.clipStats.div + state.clipStats.add + state.clipStats.cmp)}</pre>
        </div>`;

        if (state.lastQueryTime !== undefined) {
            html += `<div class="result-item">
                <h4>Spatial Index</h4>
                <pre>Тип: ${state.spatial}
Кандидатов: ${state.lastCandidates || 0}
Время запроса: ${state.lastQueryTime.toFixed(3)} мс</pre>
            </div>`;
        }

        container.innerHTML = html;
    }

    function renderLog() {
        const container = $('log-content');
        container.innerHTML = state.log.slice(0, 50).map(e =>
            `<div class="log-entry ${e.type}">[${e.time}] ${e.msg}</div>`
        ).join('');
    }

    function updateWindowInfo() {
        const w = state.window;
        $('window-coords').textContent = `X: ${w.xmin.toFixed(0)}-${w.xmax.toFixed(0)}, Y: ${w.ymin.toFixed(0)}-${w.ymax.toFixed(0)}`;
    }

    function updateStatusBar() {
        $('status-zoom').textContent = `Масштаб: ${Math.round(state.scale * 100)}%`;
        $('op-counter').textContent = `Операций: ${state.clipStats.mul + state.clipStats.div + state.clipStats.add + state.clipStats.cmp}`;
        $('time-counter').textContent = `Время: ${state.clipStats.time.toFixed(2)} мс`;
    }

    function getAlgoName(key) {
        const names = {
            'cohen': 'Сазерленд-Коэн',
            'liang': 'Лианг-Барски',
            'midpoint': 'Средней точки',
            'cyrus': 'Сайрус-Бек'
        };
        return names[key] || key;
    }

    // ═════════════════════════════════════════════════════════
    //  ВЗАИМОДЕЙСТВИЕ С ПОЛЬЗОВАТЕЛЕМ
    // ═════════════════════════════════════════════════════════

    function setupCanvasEvents() {
        canvas.addEventListener('mousedown', onCanvasMouseDown);
        canvas.addEventListener('mousemove', onCanvasMouseMove);
        canvas.addEventListener('mouseup', onCanvasMouseUp);
        canvas.addEventListener('wheel', onCanvasWheel, { passive: false });
        canvas.addEventListener('contextmenu', e => e.preventDefault());
    }

    function getMousePos(e) {
        const rect = canvas.getBoundingClientRect();
        return new Point(e.clientX, e.clientY);
    }

    function onCanvasMouseDown(e) {
        const pos = getMousePos(e);
        state.dragStart = pos;
        state.isDragging = true;

        if (state.tool === 'pan') {
            state.dragMode = 'pan';
            canvas.style.cursor = 'grabbing';
        } else if (state.tool === 'line') {
            const wp = screenToWorld(e.clientX, e.clientY);
            state.drawingLine = new Line(wp.x, wp.y, wp.x, wp.y);
            state.dragMode = 'line';
        } else if (state.tool === 'poly') {
            const wp = screenToWorld(e.clientX, e.clientY);
            if (!state.drawingPoly) state.drawingPoly = [];
            // Проверяем, не кликнули ли на первую вершину (для замыкания)
            if (state.drawingPoly.length > 2) {
                const first = state.drawingPoly[0];
                if (Math.hypot(first.x - wp.x, first.y - wp.y) < 10 / state.scale) {
                    // Замыкаем полигон
                    const poly = new Polygon([...state.drawingPoly], state.nextId++);
                    state.polygons.push(poly);
                    state.drawingPoly = null;
                    renderPolyList();
                    state.isDragging = false;
                    log(`Добавлен полигон #${poly.id} (${poly.size} вершин)`, 'success');
                    return;
                }
            }
            state.drawingPoly.push(wp);
            state.dragMode = 'poly';
        } else if (state.tool === 'window') {
            state.dragMode = 'window';
        }
    }

    function onCanvasMouseMove(e) {
        const pos = getMousePos(e);
        const wp = screenToWorld(e.clientX, e.clientY);
        $('status-coords').textContent = `Координаты: (${wp.x.toFixed(1)}, ${wp.y.toFixed(1)})`;

        if (!state.isDragging) return;

        const dx = (pos.x - state.dragStart.x) / state.scale;
        const dy = (pos.y - state.dragStart.y) / state.scale;

        switch (state.dragMode) {
            case 'pan':
                state.offset.x -= dx;
                state.offset.y -= dy;
                break;
            case 'line':
                if (state.drawingLine) {
                    state.drawingLine.p2 = wp;
                }
                break;
            case 'window':
                const start = screenToWorld(state.dragStart.x, state.dragStart.y);
                state.window = new Rect(
                    Math.min(start.x, wp.x),
                    Math.min(start.y, wp.y),
                    Math.max(start.x, wp.x),
                    Math.max(start.y, wp.y)
                );
                updateWindowInfo();
                break;
        }

        state.dragStart = pos;
    }

    function onCanvasMouseUp(e) {
        if (state.dragMode === 'line' && state.drawingLine) {
            const len = state.drawingLine.length();
            if (len > EPS) {
                state.drawingLine.id = state.nextId++;
                state.lines.push(state.drawingLine);
                spatialIndex.aabb.addLine(state.drawingLine);
                renderLineList();
                log(`Добавлен отрезок #${state.drawingLine.id}`, 'success');
            }
            state.drawingLine = null;
        }

        state.isDragging = false;
        state.dragMode = null;
        canvas.style.cursor = state.tool === 'pan' ? 'grab' : 'crosshair';
    }

    function onCanvasWheel(e) {
        e.preventDefault();
        const pos = getMousePos(e);
        const wpBefore = screenToWorld(e.clientX, e.clientY);

        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        state.scale *= factor;
        state.scale = Math.max(0.05, Math.min(50, state.scale));

        const wpAfter = screenToWorld(e.clientX, e.clientY);
        state.offset.x += (wpAfter.x - wpBefore.x);
        state.offset.y += (wpAfter.y - wpBefore.y);

        updateStatusBar();
    }

    // ═════════════════════════════════════════════════════════
    //  ТЕСТОВЫЕ НАБОРЫ (ВЫРОЖДЕННЫЕ СЛУЧАИ)
    // ═════════════════════════════════════════════════════════

    function loadBoundaryTest() {
        state.lines = [
            new Line(100, 100, 400, 100, state.nextId++), // Нижняя граница
            new Line(100, 400, 400, 400, state.nextId++), // Верхняя граница
            new Line(100, 100, 100, 400, state.nextId++), // Левая граница
            new Line(400, 100, 400, 400, state.nextId++), // Правая граница
            new Line(100, 100, 400, 400, state.nextId++), // Диагональ по границе
        ];
        state.window = new Rect(100, 100, 400, 400);
        renderLineList();
        log('Загружен тест: отрезки на границах окна', 'info');
    }

    function loadZeroLengthTest() {
        state.lines = [
            new Line(150, 200, 150, 200, state.nextId++), // Точка внутри
            new Line(100, 100, 100, 100, state.nextId++), // Точка на вершине (LB)
            new Line(400, 100, 400, 100, state.nextId++), // Точка на вершине (RB)
            new Line(400, 400, 400, 400, state.nextId++), // Точка на вершине (RT)
            new Line(100, 400, 100, 400, state.nextId++), // Точка на вершине (LT)
            new Line(250, 100, 250, 100, state.nextId++), // Точка на нижней грани
        ];
        state.window = new Rect(100, 100, 400, 400);
        renderLineList();
        log('Загружен тест: нулевые отрезки (точки)', 'info');
    }

    function loadVertexTest() {
        state.lines = [
            new Line(50, 100, 550, 400, state.nextId++),  // Проходит через верхнюю правую
            new Line(50, 400, 550, 100, state.nextId++),  // Проходит через верхнюю левую
            new Line(100, 50, 400, 550, state.nextId++),  // Проходит через нижние вершины
            new Line(250, 50, 250, 550, state.nextId++),  // Через центр, вертикально
        ];
        state.window = new Rect(100, 100, 400, 400);
        renderLineList();
        log('Загружен тест: отрезки через вершины окна', 'info');
    }

    function loadInsideOutsideTest() {
        state.lines = [
            new Line(150, 150, 350, 350, state.nextId++), // Полностью внутри
            new Line(50, 50, 80, 80, state.nextId++),     // Полностью снаружи
            new Line(0, 250, 50, 250, state.nextId++),    // Слева от окна
            new Line(450, 250, 500, 250, state.nextId++), // Справа от окна
            new Line(250, 0, 250, 50, state.nextId++),    // Ниже окна
            new Line(250, 450, 250, 500, state.nextId++), // Выше окна
        ];
        state.window = new Rect(100, 100, 400, 400);
        renderLineList();
        log('Загружен тест: полностью внутри/снаружи', 'info');
    }

    // ═════════════════════════════════════════════════════════
    //  БЕНЧМАРК
    // ═════════════════════════════════════════════════════════

    function runBenchmark() {
        const sizes = [1000, 5000, 10000, 50000, 100000, 500000];
        const results = [];

        for (const size of sizes) {
            // Генерируем данные
            const lines = [];
            for (let i = 0; i < size; i++) {
                const x1 = Math.random() * 1000;
                const y1 = Math.random() * 1000;
                const len = Math.random() * 200;
                const angle = Math.random() * Math.PI * 2;
                lines.push(new Line(x1, y1, x1 + len * Math.cos(angle), y1 + len * Math.sin(angle)));
            }

            const rect = new Rect(100, 100, 400, 400);

            // Тест Сазерленд-Коэн
            resetCounter();
            let start = performance.now();
            let visible1 = 0;
            for (const l of lines) {
                if (sutherlandCohen(l, rect)) visible1++;
            }
            const time1 = performance.now() - start;

            // Тест Лианг-Барски
            resetCounter();
            start = performance.now();
            let visible2 = 0;
            for (const l of lines) {
                if (liangBarsky(l, rect)) visible2++;
            }
            const time2 = performance.now() - start;

            results.push({ size, time1, time2, visible1, visible2 });
            log(`Бенчмарк ${size}: Коэн=${time1.toFixed(1)}мс, Лианг=${time2.toFixed(1)}мс`, 'success');
        }

        showBenchmarkReport(results);
    }

    function showBenchmarkReport(results) {
        const body = $('stats-body');

        let html = '<h3>Сравнение алгоритмов отсечения отрезков</h3>';
        html += '<table><tr><th>Размер</th><th>Сазерленд-Коэн (мс)</th><th>Лианг-Барски (мс)</th><th>Ускорение</th></tr>';
        for (const r of results) {
            const speedup = (r.time1 / r.time2).toFixed(2);
            html += `<tr><td>${r.size}</td><td>${r.time1.toFixed(2)}</td><td>${r.time2.toFixed(2)}</td><td>${speedup}x</td></tr>`;
        }
        html += '</table>';

        // График
        html += '<div class="chart-container"><canvas id="bench-chart" width="500" height="200"></canvas></div>';
        html += '<p class="hint">Лианг-Барски эффективнее на больших объёмах данных за счёт меньшего количества арифметических операций.</p>';

        $('stats-modal').classList.remove('hidden');
        body.innerHTML = html;

        // Рисуем график
        setTimeout(() => {
            const chartCanvas = document.getElementById('bench-chart');
            if (!chartCanvas) return;
            const cctx = chartCanvas.getContext('2d');
            const w = 500, h = 200;
            cctx.clearRect(0, 0, w, h);

            const maxSize = Math.max(...results.map(r => r.size));
            const maxTime = Math.max(...results.map(r => Math.max(r.time1, r.time2)));

            const pad = 40;
            const plotW = w - pad * 2;
            const plotH = h - pad * 2;

            // Оси
            cctx.strokeStyle = '#666';
            cctx.lineWidth = 1;
            cctx.beginPath();
            cctx.moveTo(pad, pad);
            cctx.lineTo(pad, h - pad);
            cctx.lineTo(w - pad, h - pad);
            cctx.stroke();

            // Масштаб (логарифмический по X)
            function sx(val) {
                return pad + (Math.log10(val) / Math.log10(maxSize)) * plotW;
            }
            function sy(val) {
                return h - pad - (val / maxTime) * plotH;
            }

            // Линия Коэна
            cctx.strokeStyle = '#e94560';
            cctx.lineWidth = 2;
            cctx.beginPath();
            results.forEach((r, i) => {
                if (i === 0) cctx.moveTo(sx(r.size), sy(r.time1));
                else cctx.lineTo(sx(r.size), sy(r.time1));
            });
            cctx.stroke();

            // Линия Лианга
            cctx.strokeStyle = '#69f0ae';
            cctx.lineWidth = 2;
            cctx.beginPath();
            results.forEach((r, i) => {
                if (i === 0) cctx.moveTo(sx(r.size), sy(r.time2));
                else cctx.lineTo(sx(r.size), sy(r.time2));
            });
            cctx.stroke();

            // Легенда
            cctx.font = '12px monospace';
            cctx.fillStyle = '#e94560';
            cctx.fillText('■ Сазерленд-Коэн', w - 180, 20);
            cctx.fillStyle = '#69f0ae';
            cctx.fillText('■ Лианг-Барски', w - 180, 40);

            // Подписи
            cctx.fillStyle = '#aaa';
            cctx.fillText('Размер данных', w / 2 - 40, h - 5);
            cctx.save();
            cctx.translate(10, h / 2);
            cctx.rotate(-Math.PI / 2);
            cctx.fillText('Время (мс)', 0, 0);
            cctx.restore();
        }, 100);
    }

    // ═════════════════════════════════════════════════════════
    //  ИНИЦИАЛИЗАЦИЯ
    // ═════════════════════════════════════════════════════════

    function setupEventListeners() {
        // Алгоритм отрезков
        $('algo-lines').addEventListener('change', (e) => {
            state.algo = e.target.value;
            log(`Алгоритм отрезков: ${getAlgoName(state.algo)}`, 'info');
        });

        // Алгоритм полигонов
        $('algo-poly').addEventListener('change', (e) => {
            state.polyAlgo = e.target.value;
            log(`Алгоритм полигонов: ${e.target.value === 'weiler' ? 'Уайлер-Атертон' : 'Грейнер-Хорман'}`, 'info');
        });

        // Spatial index
        $('spatial-index').addEventListener('change', (e) => {
            state.spatial = e.target.value;
            spatialIndex.setType(state.spatial);
            if (state.spatial !== 'none' && state.lines.length > 0) {
                const result = spatialIndex.build(state.lines);
                log(`Построен индекс: ${result.nodes} узлов`, 'success');
            }
            log(`Spatial index: ${state.spatial}`, 'info');
        });

        // Инструменты
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.tool = btn.dataset.tool;
                canvas.className = `tool-${state.tool}`;
                canvas.style.cursor = state.tool === 'pan' ? 'grab' : 'crosshair';
            });
        });

        // Загрузка файла
        $('btn-load-file').addEventListener('click', () => $('file-input').click());
        $('file-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => loadFromFile(e.target.result);
            reader.readAsText(file);
        });

        // Демо
        $('btn-load-demo').addEventListener('click', loadDemoData);

        // Генерация
        $('btn-generate-big').addEventListener('click', () => {
            const count = prompt('Количество отрезков:', '500000') || '500000';
            generateBigData(parseInt(count));
        });

        // Отсечение
        $('btn-clip-all').addEventListener('click', performClipping);

        // Сброс
        $('btn-reset').addEventListener('click', () => {
            state.offset = new Point(0, 0);
            state.scale = 1;
            state.results = [];
            state.polyResults = [];
            render();
            updateStatusBar();
            log('Вид сброшен', 'info');
        });

        // Статистика
        $('btn-stats').addEventListener('click', () => {
            showBenchmarkReport([
                { size: 1000, time1: 0, time2: 0 },
                { size: 5000, time1: 0, time2: 0 },
                { size: 10000, time1: 0, time2: 0 },
                { size: 50000, time1: 0, time2: 0 },
                { size: 100000, time1: 0, time2: 0 },
                { size: 500000, time1: 0, time2: 0 },
            ]);
        });

        // Тесты
        document.querySelectorAll('[data-test]').forEach(btn => {
            btn.addEventListener('click', () => {
                const test = btn.dataset.test;
                switch (test) {
                    case 'boundary': loadBoundaryTest(); break;
                    case 'zero': loadZeroLengthTest(); break;
                    case 'vertex': loadVertexTest(); break;
                    case 'inside': loadInsideOutsideTest(); break;
                }
            });
        });

        // Бенчмарк
        $('btn-benchmark').addEventListener('click', runBenchmark);

        // Показ AABB
        $('show-aabb').addEventListener('change', (e) => {
            state.showAABB = e.target.checked;
        });

        // Показ сетки
        $('show-grid').addEventListener('change', (e) => {
            state.showGrid = e.target.checked;
        });

        // Добавить отрезок (ручной ввод)
        $('btn-add-line').addEventListener('click', () => {
            $('line-modal').classList.remove('hidden');
        });

        $('line-modal-add').addEventListener('click', () => {
            const x1 = parseFloat($('line-x1').value) || 0;
            const y1 = parseFloat($('line-y1').value) || 0;
            const x2 = parseFloat($('line-x2').value) || 0;
            const y2 = parseFloat($('line-y2').value) || 0;
            const line = new Line(x1, y1, x2, y2, state.nextId++);
            state.lines.push(line);
            spatialIndex.aabb.addLine(line);
            $('line-modal').classList.add('hidden');
            renderLineList();
            log(`Добавлен отрезок #${line.id}`, 'success');
        });

        // Добавить полигон
        $('btn-add-poly').addEventListener('click', () => {
            $('poly-modal').classList.remove('hidden');
        });

        $('poly-modal-add').addEventListener('click', () => {
            const text = $('poly-vertices').value.trim();
            const parts = text.split(/[;\n]+/).map(s => s.trim()).filter(s => s);
            const vertices = [];
            for (const part of parts) {
                const [x, y] = part.split(/[,\s]+/).map(Number);
                if (!isNaN(x) && !isNaN(y)) {
                    vertices.push(new Point(x, y));
                }
            }
            if (vertices.length >= 3) {
                const poly = new Polygon(vertices, state.nextId++);
                state.polygons.push(poly);
                $('poly-modal').classList.add('hidden');
                renderPolyList();
                log(`Добавлен полигон #${poly.id} (${poly.size} вершин)`, 'success');
            } else {
                log('Полигон должен иметь мин. 3 вершины', 'error');
            }
        });

        // Закрытие модальных окон
        document.querySelectorAll('[data-close]').forEach(el => {
            el.addEventListener('click', () => {
                $(el.dataset.close).classList.add('hidden');
            });
        });

        // Переключение панелей
        document.querySelectorAll('.panel-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const panelName = tab.dataset.panel;
                const parent = tab.closest('aside');
                parent.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                parent.querySelectorAll('.panel-content').forEach(p => p.classList.add('hidden'));
                $(`panel-${panelName}`).classList.remove('hidden');
            });
        });

        // Клавиатура
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (state.selectedLine !== null) {
                    state.lines = state.lines.filter(l => l.id !== state.selectedLine);
                    state.selectedLine = null;
                    renderLineList();
                }
            }
            if (e.key === 'Escape') {
                state.drawingPoly = null;
                document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
            }
            if (e.key === 'Enter' && state.tool === 'poly' && state.drawingPoly && state.drawingPoly.length >= 3) {
                const poly = new Polygon([...state.drawingPoly], state.nextId++);
                state.polygons.push(poly);
                state.drawingPoly = null;
                renderPolyList();
            }
        });
    }

    // ═════════════════════════════════════════════════════════
    //  ГЛАВНЫЙ ЦИКЛ
    // ═════════════════════════════════════════════════════════

    let lastTime = performance.now();
    let frameCount = 0;

    function gameLoop() {
        const now = performance.now();
        frameCount++;

        if (now - lastTime >= 1000) {
            state.fps = frameCount;
            frameCount = 0;
            lastTime = now;
            $('fps-counter').textContent = `FPS: ${state.fps}`;
        }

        render();
        requestAnimationFrame(gameLoop);
    }

    // ═════════════════════════════════════════════════════════
    //  ЗАПУСК
    // ═════════════════════════════════════════════════════════

    function init() {
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        setupCanvasEvents();
        setupEventListeners();

        // Загрузить демо-данные по умолчанию
        loadDemoData();
        performClipping();

        // Начать цикл отрисовки
        requestAnimationFrame(gameLoop);

        log('Приложение инициализировано', 'success');
    }

    // Запуск после загрузки DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
