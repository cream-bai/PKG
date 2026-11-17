/**
 * ============================================================
 * spatial.js — Пространственные структуры данных
 * - AABB (Axis-Aligned Bounding Box) пре-фильтрация
 * - Quadtree (четверичное дерево)
 * ============================================================
 */

(function (global) {
    'use strict';

    const { EPS, INF, Point, Rect, Line } = global.Geo;

    // ═════════════════════════════════════════════════════════
    //  AABB — Ось-выровненный ограничивающий прямоугольник
    // ═════════════════════════════════════════════════════════

    class AABB {
        constructor(xmin = INF, ymin = INF, xmax = -INF, ymax = -INF) {
            this.xmin = xmin;
            this.ymin = ymin;
            this.xmax = xmax;
            this.ymax = ymax;
        }

        // AABB для отрезка
        static fromLine(line) {
            return new AABB(
                Math.min(line.p1.x, line.p2.x),
                Math.min(line.p1.y, line.p2.y),
                Math.max(line.p1.x, line.p2.x),
                Math.max(line.p1.y, line.p2.y)
            );
        }

        // AABB для массива точек
        static fromPoints(points) {
            const box = new AABB();
            for (const p of points) {
                box.expand(p);
            }
            return box;
        }

        // Расширить до включения точки
        expand(p) {
            this.xmin = Math.min(this.xmin, p.x);
            this.ymin = Math.min(this.ymin, p.y);
            this.xmax = Math.max(this.xmax, p.x);
            this.ymax = Math.max(this.ymax, p.y);
        }

        // Расширить до включения другого AABB
        expandBox(other) {
            this.xmin = Math.min(this.xmin, other.xmin);
            this.ymin = Math.min(this.ymin, other.ymin);
            this.xmax = Math.max(this.xmax, other.xmax);
            this.ymax = Math.max(this.ymax, other.ymax);
        }

        // Площадь
        area() {
            return (this.xmax - this.xmin) * (this.ymax - this.ymin);
        }

        // Пересекается с другим AABB
        intersects(other) {
            return !(other.xmax < this.xmin - EPS ||
                     other.xmin > this.xmax + EPS ||
                     other.ymax < this.ymin - EPS ||
                     other.ymin > this.ymax + EPS);
        }

        // Содержит другой AABB
        contains(other) {
            return other.xmin >= this.xmin - EPS &&
                   other.xmax <= this.xmax + EPS &&
                   other.ymin >= this.ymin - EPS &&
                   other.ymax <= this.ymax + EPS;
        }

        // Содержит точку
        containsPoint(p) {
            return p.x >= this.xmin - EPS && p.x <= this.xmax + EPS &&
                   p.y >= this.ymin - EPS && p.y <= this.ymax + EPS;
        }

        // Разделить на 4 квадранта
        split() {
            const cx = (this.xmin + this.xmax) / 2;
            const cy = (this.ymin + this.ymax) / 2;
            return {
                nw: new AABB(this.xmin, cy, cx, this.ymax),
                ne: new AABB(cx, cy, this.xmax, this.ymax),
                sw: new AABB(this.xmin, this.ymin, cx, cy),
                se: new AABB(cx, this.ymin, this.xmax, cy)
            };
        }

        // Центр
        center() {
            return new Point(
                (this.xmin + this.xmax) / 2,
                (this.ymin + this.ymax) / 2
            );
        }

        // Ширина
        width() { return this.xmax - this.xmin; }
        height() { return this.ymax - this.ymin; }

        toRect() {
            return new Rect(this.xmin, this.ymin, this.xmax, this.ymax);
        }
    }

    // ═════════════════════════════════════════════════════════
    //  AABB PREFILTER — быстрая отбраковка
    // ═════════════════════════════════════════════════════════

    class AABBPrefilter {
        constructor() {
            this.bounds = new Map(); // lineId -> AABB
        }

        // Добавить отрезок
        addLine(line) {
            this.bounds.set(line.id, AABB.fromLine(line));
        }

        // Добавить массив отрезков
        addLines(lines) {
            for (const line of lines) {
                this.addLine(line);
            }
        }

        // Удалить отрезок
        removeLine(id) {
            this.bounds.delete(id);
        }

        // Обновить AABB отрезка
        updateLine(line) {
            this.bounds.set(line.id, AABB.fromLine(line));
        }

        // Отфильтровать отрезки, попадающие в окно
        filter(window) {
            const winBox = AABB.fromLine(new Line(
                window.xmin, window.ymin, window.xmax, window.ymax
            ));
            const result = [];
            for (const [id, box] of this.bounds) {
                if (box.intersects(winBox)) {
                    result.push(id);
                }
            }
            return result;
        }

        // Получить AABB для отрисовки
        getAllBounds() {
            return Array.from(this.bounds.values());
        }

        // Статистика
        stats() {
            return { count: this.bounds.size };
        }
    }

    // ═════════════════════════════════════════════════════════
    //  QUADTREE — Четверичное дерево
    // ═════════════════════════════════════════════════════════

    class QuadTree {
        constructor(bounds, maxDepth = 8, maxItems = 4) {
            this.bounds = bounds instanceof AABB ? bounds : AABB.fromPoints(bounds);
            this.maxDepth = maxDepth;
            this.maxItems = maxItems;
            this.items = [];           // Массив {id, aabb}
            this.children = null;      // [nw, ne, sw, se]
            this.depth = 0;
        }

        // Вставить отрезок
        insert(line, id = null) {
            const item = {
                id: id !== null ? id : line.id,
                aabb: AABB.fromLine(line),
                line: line
            };
            this._insert(item, 0);
        }

        _insert(item, depth) {
            if (this.children !== null) {
                // Уже разделено — вставляем в подходящие квадранты
                const quadrants = this._getQuadrants(item.aabb);
                for (const q of quadrants) {
                    this.children[q]._insert(item, depth + 1);
                }
                return;
            }

            this.items.push(item);

            // Проверяем, нужно ли разделить
            if (this.items.length > this.maxItems && depth < this.maxDepth) {
                this._subdivide(depth);
            }
        }

        _subdivide(depth) {
            const { nw, ne, sw, se } = this.bounds.split();

            this.children = [
                new QuadTree(nw, this.maxDepth, this.maxItems),
                new QuadTree(ne, this.maxDepth, this.maxItems),
                new QuadTree(sw, this.maxDepth, this.maxItems),
                new QuadTree(se, this.maxDepth, this.maxItems)
            ];
            this.children.forEach(c => c.depth = depth + 1);

            // Перераспределяем элементы
            const itemsToRedistribute = this.items;
            this.items = [];

            for (const item of itemsToRedistribute) {
                const quadrants = this._getQuadrants(item.aabb);
                for (const q of quadrants) {
                    this.children[q]._insert(item, depth + 1);
                }
            }
        }

        // Определить квадранты, в которые попадает AABB
        _getQuadrants(aabb) {
            const cx = (this.bounds.xmin + this.bounds.xmax) / 2;
            const cy = (this.bounds.ymin + this.bounds.ymax) / 2;
            const quadrants = [];

            const left   = aabb.xmax <= cx + EPS;
            const right  = aabb.xmin >= cx - EPS;
            const bottom = aabb.ymax <= cy + EPS;
            const top    = aabb.ymin >= cy - EPS;

            if (left && bottom)  quadrants.push(2); // SW
            if (right && bottom) quadrants.push(3); // SE
            if (left && top)     quadrants.push(0); // NW
            if (right && top)    quadrants.push(1); // NE

            // Если не попадает ни в один (пересекает центральные линии)
            if (quadrants.length === 0) {
                quadrants.push(0, 1, 2, 3);
            }

            return [...new Set(quadrants)]; // Убираем дубликаты
        }

        // Поиск всех элементов, пересекающихся с окном
        query(window, result = []) {
            const winBox = window instanceof AABB
                ? window
                : AABB.fromLine(new Line(window.xmin, window.ymin, window.xmax, window.ymax));

            if (!this.bounds.intersects(winBox)) {
                return result;
            }

            // Добавляем элементы текущего узла
            for (const item of this.items) {
                if (item.aabb.intersects(winBox)) {
                    result.push(item);
                }
            }

            // Рекурсивно обходим детей
            if (this.children !== null) {
                for (const child of this.children) {
                    child.query(winBox, result);
                }
            }

            return result;
        }

        // Поиск с использованием глубины (для аналитики)
        queryWithDepth(window, maxDepth, result = []) {
            const winBox = window instanceof AABB
                ? window
                : AABB.fromLine(new Line(window.xmin, window.ymin, window.xmax, window.ymax));

            if (!this.bounds.intersects(winBox)) return result;

            if (this.depth >= maxDepth) {
                // На этой глубине просто собираем все элементы
                for (const item of this.items) {
                    if (item.aabb.intersects(winBox)) {
                        result.push(item);
                    }
                }
                return result;
            }

            if (this.children !== null) {
                for (const child of this.children) {
                    child.queryWithDepth(winBox, maxDepth, result);
                }
            } else {
                for (const item of this.items) {
                    if (item.aabb.intersects(winBox)) {
                        result.push(item);
                    }
                }
            }

            return result;
        }

        // Количество узлов
        nodeCount() {
            let count = 1;
            if (this.children !== null) {
                for (const child of this.children) {
                    count += child.nodeCount();
                }
            }
            return count;
        }

        // Количество элементов
        itemCount() {
            let count = this.items.length;
            if (this.children !== null) {
                for (const child of this.children) {
                    count += child.itemCount();
                }
            }
            return count;
        }

        // Получить все узлы для визуализации
        getAllNodes(nodes = []) {
            nodes.push({
                bounds: this.bounds,
                depth: this.depth,
                itemCount: this.items.length
            });
            if (this.children !== null) {
                for (const child of this.children) {
                    child.getAllNodes(nodes);
                }
            }
            return nodes;
        }

        // Статистика по глубинам
        depthStats() {
            const stats = {};
            this._collectDepthStats(stats);
            return stats;
        }

        _collectDepthStats(stats) {
            if (!stats[this.depth]) {
                stats[this.depth] = { nodes: 0, items: 0 };
            }
            stats[this.depth].nodes++;
            stats[this.depth].items += this.items.length;

            if (this.children !== null) {
                for (const child of this.children) {
                    child._collectDepthStats(stats);
                }
            }
        }
    }

    // ═════════════════════════════════════════════════════════
    //  SPATIAL INDEX MANAGER — управление индексами
    // ═════════════════════════════════════════════════════════

    class SpatialIndex {
        constructor(type = 'none') {
            this.type = type;
            this.aabb = new AABBPrefilter();
            this.quadtree = null;
            this.bounds = null;
        }

        setType(type) {
            this.type = type;
        }

        // Построить индекс для набора отрезков
        build(lines, maxDepth = 8) {
            this.aabb = new AABBPrefilter();
            this.aabb.addLines(lines);

            if (this.type === 'quadtree') {
                // Вычисляем общие границы
                let xmin = INF, ymin = INF, xmax = -INF, ymax = -INF;
                for (const line of lines) {
                    xmin = Math.min(xmin, line.p1.x, line.p2.x);
                    ymin = Math.min(ymin, line.p1.y, line.p2.y);
                    xmax = Math.max(xmax, line.p1.x, line.p2.x);
                    ymax = Math.max(ymax, line.p1.y, line.p2.y);
                }
                // Добавляем отступ
                const pad = Math.max(xmax - xmin, ymax - ymin) * 0.1 + 1;
                this.bounds = new AABB(xmin - pad, ymin - pad, xmax + pad, ymax + pad);

                const startTime = performance.now();
                this.quadtree = new QuadTree(this.bounds, maxDepth, 4);
                for (const line of lines) {
                    this.quadtree.insert(line);
                }
                const buildTime = performance.now() - startTime;

                return { buildTime, nodes: this.quadtree.nodeCount() };
            }

            return { buildTime: 0, nodes: 0 };
        }

        // Получить кандидатов для отсечения
        query(window) {
            const start = performance.now();

            if (this.type === 'quadtree' && this.quadtree) {
                const items = this.quadtree.query(window);
                return {
                    ids: items.map(i => i.id),
                    time: performance.now() - start,
                    candidates: items.length
                };
            }

            if (this.type === 'aabb') {
                const ids = this.aabb.filter(window);
                return {
                    ids,
                    time: performance.now() - start,
                    candidates: ids.length
                };
            }

            // Без индекса — все отрезки
            return {
                ids: null, // null означает "все"
                time: 0,
                candidates: 0
            };
        }

        // Получить AABB для визуализации
        getAABBs() {
            if (this.type === 'aabb' || this.type === 'quadtree') {
                return this.aabb.getAllBounds();
            }
            return [];
        }

        getQuadtreeNodeBounds() {
            if (this.type === 'quadtree' && this.quadtree) {
                return this.quadtree.getAllNodes().map(n => n.bounds);
            }
            return [];
        }

        // Статистика
        stats() {
            const s = {
                type: this.type,
                aabbCount: this.aabb.stats().count
            };
            if (this.quadtree) {
                s.qtNodes = this.quadtree.nodeCount();
                s.qtItems = this.quadtree.itemCount();
                s.qtDepth = this.quadtree.depthStats();
            }
            return s;
        }
    }

    // Экспорт
    global.Spatial = {
        AABB,
        AABBPrefilter,
        QuadTree,
        SpatialIndex
    };

})(window);
