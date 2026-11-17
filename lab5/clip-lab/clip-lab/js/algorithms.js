/**
 * ============================================================
 * algorithms.js — Алгоритмы отсечения отрезков и многоугольников
 * - Сазерленд-Коэн
 * - Лианг-Барски
 * - Алгоритм средней точки (Midpoint subdivision)
 * - Сайрус-Бек
 * - Уайлер-Атертон
 * - Грейнер-Хорман
 * ============================================================
 */

(function (global) {
    'use strict';

    const { EPS, EPS2, INF, Point, Vec2, Line, Rect, Polygon,
            lineIntersection, segmentLineIntersection,
            pointOnSegment, segmentIntersection,
            pointInPolygon, orient,
            CohenCodes, cohenSutherlandCode } = global.Geo;

    // ═════════════════════════════════════════════════════════
    //  СЧЁТЧИК АРИФМЕТИЧЕСКИХ ОПЕРАЦИЙ
    // ═════════════════════════════════════════════════════════

    class OpCounter {
        constructor() { this.reset(); }
        reset() {
            this.mul = 0; this.div = 0;
            this.add = 0; this.sub = 0;
            this.cmp = 0;
        }
        // Эмуляция подсчёта для внешнего кода
        count(ops) {
            if (ops.mul) this.mul += ops.mul;
            if (ops.div) this.div += ops.div;
            if (ops.add) this.add += ops.add;
            if (ops.sub) this.sub += ops.sub;
            if (ops.cmp) this.cmp += ops.cmp;
        }
        total() { return this.mul + this.div + this.add + this.sub + this.cmp; }
    }

    const counter = new OpCounter();

    // ═════════════════════════════════════════════════════════
    //  1. АЛГОРИТМ САЗЕРЛЕНДА-КОЭНА
    //  Структурный (region-based) алгоритм
    // ═════════════════════════════════════════════════════════

    /**
     * Отсекает отрезок прямоугольным окном по алгоритму Сазерленда-Коэна
     * @param {Line} line - исходный отрезок
     * @param {Rect} rect - отсекающее окно
     * @param {OpCounter} [cnt] - счётчик операций
     * @returns {Line|null} - видимая часть отрезка или null, если невидим
     */
    function sutherlandCohen(line, rect, cnt = counter) {
        let x1 = line.p1.x, y1 = line.p1.y;
        let x2 = line.p2.x, y2 = line.p2.y;
        let code1 = cohenSutherlandCode(new Point(x1, y1), rect);
        let code2 = cohenSutherlandCode(new Point(x2, y2), rect);
        cnt.count({ cmp: 2 });

        let accept = false;

        while (true) {
            if ((code1 | code2) === 0) {
                // Оба конца внутри — полностью видим
                accept = true;
                break;
            } else if ((code1 & code2) !== 0) {
                // Оба конца в одной внешней области — невидим
                break;
            } else {
                // Нужно отсекать
                let codeOut = code1 !== 0 ? code1 : code2;
                let x, y;

                cnt.count({ cmp: 6, add: 4, mul: 2, div: 0 });

                // Пересечение с соответствующей границей
                if (codeOut & CohenCodes.TOP) {           // Верх
                    x = x1 + (x2 - x1) * (rect.ymax - y1) / (y2 - y1);
                    y = rect.ymax;
                    cnt.count({ add: 3, mul: 2, div: 1 });
                } else if (codeOut & CohenCodes.BOTTOM) { // Низ
                    x = x1 + (x2 - x1) * (rect.ymin - y1) / (y2 - y1);
                    y = rect.ymin;
                    cnt.count({ add: 3, mul: 2, div: 1 });
                } else if (codeOut & CohenCodes.RIGHT) {  // Правая
                    y = y1 + (y2 - y1) * (rect.xmax - x1) / (x2 - x1);
                    x = rect.xmax;
                    cnt.count({ add: 3, mul: 2, div: 1 });
                } else {                                  // LEFT — левая
                    y = y1 + (y2 - y1) * (rect.xmin - x1) / (x2 - x1);
                    x = rect.xmin;
                    cnt.count({ add: 3, mul: 2, div: 1 });
                }

                // Заменяем внешнюю точку точкой пересечения
                if (codeOut === code1) {
                    x1 = x; y1 = y;
                    code1 = cohenSutherlandCode(new Point(x1, y1), rect);
                } else {
                    x2 = x; y2 = y;
                    code2 = cohenSutherlandCode(new Point(x2, y2), rect);
                }
                cnt.count({ cmp: 1 });
            }
        }

        if (accept) {
            // Проверка на вырожденный случай (точка)
            if (Math.hypot(x2 - x1, y2 - y1) < EPS) {
                // Возвращаем как точку
            }
            return new Line(x1, y1, x2, y2, line.id);
        }
        return null;
    }

    // ═════════════════════════════════════════════════════════
    //  2. АЛГОРИТМ ЛИАНГА-БАРСКИ (Liang-Barsky)
    //  Параметрический алгоритм
    // ═════════════════════════════════════════════════════════

    /**
     * Отсекает отрезок прямоугольным окном по алгоритму Лианга-Барски
     * @param {Line} line
     * @param {Rect} rect
     * @param {OpCounter} [cnt]
     * @returns {Line|null}
     */
    function liangBarsky(line, rect, cnt = counter) {
        const x1 = line.p1.x, y1 = line.p1.y;
        const dx = line.p2.x - x1;
        const dy = line.p2.y - y1;
        cnt.count({ sub: 4 });

        let t0 = 0, t1 = 1;
        cnt.count({ cmp: 0 });

        // Параметры: p, q для каждой границы
        const p = [-dx, dx, -dy, dy];
        const q = [
            x1 - rect.xmin,  // LEFT
            rect.xmax - x1,  // RIGHT
            y1 - rect.ymin,  // BOTTOM
            rect.ymax - y1   // TOP
        ];
        cnt.count({ add: 4, sub: 4 });

        for (let i = 0; i < 4; i++) {
            cnt.count({ cmp: 2 });
            if (Math.abs(p[i]) < EPS) {
                // Отрезок параллелен границе
                if (q[i] < -EPS) return null; // Полностью снаружи
            } else {
                const r = q[i] / p[i];
                cnt.count({ div: 1 });
                if (p[i] < 0) {
                    if (r > t1) return null;
                    if (r > t0) t0 = r;
                    cnt.count({ cmp: 2 });
                } else {
                    if (r < t0) return null;
                    if (r < t1) t1 = r;
                    cnt.count({ cmp: 2 });
                }
            }
        }

        cnt.count({ mul: 4, add: 4 });

        const nx1 = x1 + t0 * dx;
        const ny1 = y1 + t0 * dy;
        const nx2 = x1 + t1 * dx;
        const ny2 = y1 + t1 * dy;

        return new Line(nx1, ny1, nx2, ny2, line.id);
    }

    // ═════════════════════════════════════════════════════════
    //  3. АЛГОРИТМ СРЕДНЕЙ ТОЧКИ (Midpoint Subdivision)
    //  Рекурсивный алгоритм
    // ═════════════════════════════════════════════════════════

    /**
     * Отсекает отрезок методом средней точки
     * @param {Line} line
     * @param {Rect} rect
     * @param {number} [maxDepth=24]
     * @param {OpCounter} [cnt]
     * @returns {Line[]} - массив видимых отрезков
     */
    function midpointSubdivision(line, rect, maxDepth = 24, cnt = counter) {
        const result = [];
        _midpointClip(line.p1, line.p2, rect, 0, maxDepth, result, cnt);
        // Склеиваем смежные отрезки
        return mergeAdjacentSegments(result);
    }

    function _midpointClip(p1, p2, rect, depth, maxDepth, result, cnt) {
        cnt.count({ cmp: 1, add: 0 });
        if (depth > maxDepth) {
            // Достигли предела — возвращаем среднюю точку как вырожденный отрезок
            const mid = new Point((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
            if (rect.containsAABB(mid.x, mid.y)) {
                result.push(new Line(mid.x, mid.y, mid.x, mid.y));
            }
            return;
        }

        const code1 = cohenSutherlandCode(p1, rect);
        const code2 = cohenSutherlandCode(p2, rect);
        cnt.count({ cmp: 2 });

        if ((code1 | code2) === 0) {
            // Оба конца внутри — весь отрезок видим
            result.push(new Line(p1.x, p1.y, p2.x, p2.y));
            return;
        }

        if ((code1 & code2) !== 0) {
            // Оба в одной внешней зоне — невидим
            return;
        }

        // Делим пополам
        const mid = new Point((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
        cnt.count({ add: 2, mul: 2 });
        _midpointClip(p1, mid, rect, depth + 1, maxDepth, result, cnt);
        _midpointClip(mid, p2, rect, depth + 1, maxDepth, result, cnt);
    }

    function mergeAdjacentSegments(segments) {
        if (segments.length <= 1) return segments;
        const merged = [segments[0]];
        for (let i = 1; i < segments.length; i++) {
            const last = merged[merged.length - 1];
            const curr = segments[i];
            if (last.p2.equals(curr.p1, EPS)) {
                last.p2 = curr.p2.clone();
            } else {
                merged.push(curr.clone());
            }
        }
        return merged;
    }

    // ═════════════════════════════════════════════════════════
    //  4. АЛГОРИТМ САЙРУСА-БЕКА (Cyrus-Beck)
    //  Параметрический для произвольного выпуклого отсекателя
    // ═════════════════════════════════════════════════════════

    /**
     * Отсекает отрезок выпуклым многоугольником (окном)
     * @param {Line} line - отрезок
     * @param {Polygon} clipper - выпуклый отсекатель (по часовой стрелке)
     * @param {OpCounter} [cnt]
     * @returns {Line|null}
     */
    function cyrusBeck(line, clipper, cnt = counter) {
        const n = clipper.size;
        if (n < 3) return null;

        const P1 = line.p1, P2 = line.p2;
        const D = new Point(P2.x - P1.x, P2.y - P1.y); // Направление отрезка
        cnt.count({ sub: 2 });

        let tEnter = 0, tExit = 1;
        cnt.count({ cmp: 0 });

        const normals = computeInwardNormals(clipper);

        for (let i = 0; i < n; i++) {
            const Fi = clipper.vertices[i];
            const Ni = normals[i];

            // Числитель: Ni · (Fi - P1)
            const num = Ni.x * (Fi.x - P1.x) + Ni.y * (Fi.y - P1.y);
            // Знаменатель: Ni · D
            const den = Ni.x * D.x + Ni.y * D.y;
            cnt.count({ mul: 4, add: 2, cmp: 1 });

            if (Math.abs(den) < EPS2) {
                // Отрезок параллелен грани
                if (num < -EPS) return null; // Снаружи
            } else {
                const t = num / den;
                cnt.count({ div: 1 });
                if (den < 0) {
                    // Входящая грань
                    if (t > tExit) return null;
                    if (t > tEnter) tEnter = t;
                    cnt.count({ cmp: 2 });
                } else {
                    // Исходящая грань
                    if (t < tEnter) return null;
                    if (t < tExit) tExit = t;
                    cnt.count({ cmp: 2 });
                }
            }
        }

        cnt.count({ mul: 4, add: 4 });

        if (tEnter > tExit + EPS) return null;

        const x1 = P1.x + tEnter * D.x;
        const y1 = P1.y + tEnter * D.y;
        const x2 = P1.x + tExit * D.x;
        const y2 = P1.y + tExit * D.y;

        return new Line(x1, y1, x2, y2, line.id);
    }

    // Вычисление внутренних нормалей для выпуклого полигона (по часовой стрелке)
    function computeInwardNormals(poly) {
        const n = poly.size;
        const normals = [];
        for (let i = 0; i < n; i++) {
            const Pi = poly.vertices[i];
            const Pj = poly.vertices[(i + 1) % n];
            // Ребро от Pi к Pj, нормаль направо от направления (для CW)
            const edge = new Point(Pj.x - Pi.x, Pj.y - Pi.y);
            let normal = new Point(edge.y, -edge.x); // Правая нормаль
            // Нормализуем
            const len = normal.len();
            if (len > EPS) normal = normal.div(len);
            normals.push(normal);
        }
        return normals;
    }

    // ═════════════════════════════════════════════════════════
    //  5. АЛГОРИТМ УАЙЛЕРА-АТЕРТОНА (Weiler-Atherton)
    //  Отсечение произвольных (в т.ч. вогнутых) полигонов
    // ═════════════════════════════════════════════════════════

    /**
     * Отсекает субъект полигоном-отсекателем
     * @param {Polygon} subject - исходный полигон
     * @param {Polygon} clip - отсекатель (выпуклый или нет)
     * @returns {Polygon[]} - массив результирующих полигонов
     */
    function weilerAtherton(subject, clip) {
        // 1. Построить списки рёбер
        const subjEdges = buildEdgeList(subject);
        const clipEdges = buildEdgeList(clip);

        // 2. Найти все точки пересечения и добавить их в списки рёбер
        const intersections = findAllIntersections(subjEdges, clipEdges);

        if (intersections.length === 0) {
            // Нет пересечений — проверяем вложенность
            if (isPolygonInside(subject, clip)) {
                return [subject.clone()];
            }
            if (isPolygonInside(clip, subject)) {
                return [clip.clone()];
            }
            return [];
        }

        // 3. Пометить точки пересечения в обоих списках
        markIntersections(subjEdges, clipEdges, intersections);

        // 4. Обойти списки, чередуя субъект и отсекатель
        return traverseLists(subjEdges, clipEdges);
    }

    // Узел списка рёбер
    class EdgeNode {
        constructor(start, end) {
            this.start = start;       // Point
            this.end = end;           // Point
            this.intersections = [];  // Массив точек пересечения
            this.next = null;         // Следующий узел
            this.prev = null;         // Предыдущий узел
            this.visited = false;     // Посещена ли эта вершина при обходе
            this.isIntersection = false;
        }
    }

    function buildEdgeList(poly) {
        const v = poly.closedVertices();
        const nodes = [];
        for (let i = 0; i < v.length - 1; i++) {
            nodes.push(new EdgeNode(v[i].clone(), v[i + 1].clone()));
        }
        // Двусвязный список
        for (let i = 0; i < nodes.length; i++) {
            nodes[i].next = nodes[(i + 1) % nodes.length];
            nodes[i].prev = nodes[(i - 1 + nodes.length) % nodes.length];
        }
        return nodes;
    }

    function findAllIntersections(subjEdges, clipEdges) {
        const intersections = [];
        for (const se of subjEdges) {
            for (const ce of clipEdges) {
                const seg1 = new Line(se.start.x, se.start.y, se.end.x, se.end.y);
                const seg2 = new Line(ce.start.x, ce.start.y, ce.end.x, ce.end.y);
                const inter = segmentIntersection(seg1, seg2);
                if (inter && inter.type === 'proper') {
                    intersections.push({
                        point: inter.point,
                        subjEdge: se,
                        clipEdge: ce
                    });
                }
            }
        }
        return intersections;
    }

    function markIntersections(subjEdges, clipEdges, intersections) {
        for (const inter of intersections) {
            // Добавляем точку пересечения в оба списка
            insertIntersection(inter.subjEdge, inter.point);
            insertIntersection(inter.clipEdge, inter.point);
        }
    }

    function insertIntersection(edge, point) {
        // Проверяем, есть ли уже такая точка
        for (const ip of edge.intersections) {
            if (ip.equals(point, EPS)) return;
        }
        edge.intersections.push(point.clone());
        edge.intersections.sort((a, b) => {
            const da = a.distTo(edge.start);
            const db = b.distTo(edge.start);
            return da - db;
        });
    }

    function traverseLists(subjEdges, clipEdges) {
        const result = [];
        const allNodes = [...subjEdges, ...clipEdges];

        // Находим непосещённую точку пересечения
        for (const node of allNodes) {
            for (const ip of node.intersections) {
                if (!ip.visited) {
                    // Начинаем обход
                    const poly = buildPolygonFromIntersection(node, ip, subjEdges, clipEdges);
                    if (poly && poly.size >= 3) {
                        result.push(poly);
                    }
                }
            }
        }

        return result;
    }

    function buildPolygonFromIntersection(startNode, startPoint, subjEdges, clipEdges) {
        const vertices = [];
        let currentNode = startNode;
        let currentPoint = startPoint;
        let enteredClip = false;

        // Определяем направление: внутри отсекателя или снаружи
        // Первая точка пересечения — входим в отсекатель
        let useClip = true;

        while (true) {
            currentPoint.visited = true;
            vertices.push(currentPoint.clone());

            if (useClip) {
                // Двигаемся по списку отсекателя
                currentNode = findNextInList(clipEdges, currentNode, currentPoint);
            } else {
                currentNode = findNextInList(subjEdges, currentNode, currentPoint);
            }

            if (!currentNode) break;

            // Находим следующую точку пересечения на этом ребре
            const nextInter = currentNode.intersections.find(ip => !ip.visited);
            if (nextInter) {
                useClip = !useClip; // Переключаемся между списками
                currentPoint = nextInter;
            } else {
                // Идём до конца ребра
                currentPoint = currentNode.end.clone();
                currentNode = currentNode.next;
                if (currentNode) {
                    const firstInter = currentNode.intersections.find(ip => !ip.visited);
                    if (firstInter) {
                        useClip = !useClip;
                        currentPoint = firstInter;
                    }
                }
            }

            // Проверка на завершение (вернулись к началу)
            if (currentPoint.equals(startPoint, EPS)) break;
        }

        if (vertices.length < 3) return null;
        return new Polygon(vertices);
    }

    function findNextInList(edgeList, node, point) {
        let current = node;
        for (let i = 0; i < edgeList.length; i++) {
            if (current.start.equals(point, EPS)) {
                return current;
            }
            current = current.next;
        }
        return null;
    }

    // ═════════════════════════════════════════════════════════
    //  6. АЛГОРИТМ ГРЕЙНЕРА-ХОРМАНА (Greiner-Hormann)
    //  Улучшенный алгоритм отсечения выпуклых полигонов
    // ═════════════════════════════════════════════════════════

    /**
     * Отсекает субъект полигоном
     * @param {Polygon} subject - субъект
     * @param {Polygon} clip - отсекатель (выпуклый)
     * @returns {Polygon[]} - результаты отсечения
     */
    function greinerHormann(subject, clip) {
        // 1. Создаём двусвязные списки вершин
        const sList = createVertexList(subject);
        const cList = createVertexList(clip);

        // 2. Находим пересечения
        const intersections = findIntersectionsGH(sList, cList);

        if (intersections.length === 0) {
            if (polygonInsidePolygon(subject, clip)) return [subject.clone()];
            if (polygonInsidePolygon(clip, subject)) return [clip.clone()];
            return [];
        }

        // 3. Вставляем точки пересечения в оба списка
        insertIntersectionsGH(sList, cList, intersections);

        // 4. Обходим списки для построения результата
        return constructResultGH(sList, cList);
    }

    class GHVertex {
        constructor(point, isIntersection = false) {
            this.point = point;
            this.isIntersection = isIntersection;
            this.next = null;
            this.prev = null;
            this.intersect = null; // Ссылка на соответствующую вершину в другом списке
            this.entry = true;     // true = входящая, false = исходящая
            this.visited = false;
        }
    }

    function createVertexList(poly) {
        const v = poly.closedVertices();
        const nodes = [];
        for (const p of v) {
            nodes.push(new GHVertex(p.clone()));
        }
        // Замыкаем список (исключая последнюю = первой)
        for (let i = 0; i < nodes.length - 1; i++) {
            nodes[i].next = nodes[i + 1];
            nodes[i + 1].prev = nodes[i];
        }
        return nodes.slice(0, -1); // Убираем дублирующую последнюю вершину
    }

    function findIntersectionsGH(sList, cList) {
        const result = [];
        for (let i = 0; i < sList.length; i++) {
            const si = i;
            const sj = (i + 1) % sList.length;
            for (let j = 0; j < cList.length; j++) {
                const cj = (j + 1) % cList.length;
                const seg1 = new Line(sList[si].point.x, sList[si].point.y,
                                      sList[sj].point.x, sList[sj].point.y);
                const seg2 = new Line(cList[j].point.x, cList[j].point.y,
                                      cList[cj].point.x, cList[cj].point.y);
                const inter = segmentIntersection(seg1, seg2);
                if (inter && inter.type === 'proper') {
                    result.push({
                        point: inter.point,
                        sIdx: si,
                        cIdx: j,
                        sNext: sj,
                        cNext: cj
                    });
                }
            }
        }
        return result;
    }

    function insertIntersectionsGH(sList, cList, intersections) {
        for (const inter of intersections) {
            const sVertex = new GHVertex(inter.point.clone(), true);
            const cVertex = new GHVertex(inter.point.clone(), true);
            sVertex.intersect = cVertex;
            cVertex.intersect = sVertex;

            // Определяем тип (входящая/исходящая)
            // Для субъекта: если центр отсекателя слева от ребра — входящая
            const sEdge = new Line(
                sList[inter.sIdx].point.x, sList[inter.sIdx].point.y,
                sList[inter.sNext].point.x, sList[inter.sNext].point.y
            );
            sVertex.entry = isInsideClip(sEdge, cList);
            cVertex.entry = !sVertex.entry;

            // Вставляем в списки
            insertAfter(sList, inter.sIdx, sVertex);
            insertAfter(cList, inter.cIdx, cVertex);
        }
    }

    function insertAfter(list, idx, vertex) {
        const node = list[idx];
        vertex.prev = node;
        vertex.next = node.next;
        node.next.prev = vertex;
        node.next = vertex;
    }

    function isInsideClip(edge, clipList) {
        // Проверяем, лежит ли точка на ребре субъекта внутри отсекателя
        const mid = new Point(
            (edge.p1.x + edge.p2.x) / 2,
            (edge.p1.y + edge.p2.y) / 2
        );
        return pointInPolygon(mid, new Polygon(clipList.map(v => v.point)));
    }

    function constructResultGH(sList, cList) {
        const result = [];
        const allVertices = [...sList];

        for (const v of allVertices) {
            if (v.isIntersection && !v.visited) {
                const poly = [];
                let current = v;
                do {
                    current.visited = true;
                    if (current.isIntersection) {
                        poly.push(current.point.clone());
                        if (current.entry) {
                            // Переходим к отсекателю
                            current = current.intersect;
                            current.entry = false; // Помечаем как посещённую в другом списке
                        } else {
                            current = current.next;
                        }
                    } else {
                        poly.push(current.point.clone());
                        current = current.next;
                    }
                } while (current !== v);

                if (poly.length >= 3) {
                    result.push(new Polygon(poly));
                }
            }
        }

        return result;
    }

    // ═════════════════════════════════════════════════════════
    //  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
    // ═════════════════════════════════════════════════════════

    function isPolygonInside(inner, outer) {
        if (inner.size === 0) return false;
        // Если хотя бы одна вершина внутри — возможно внутри
        let insideCount = 0;
        for (const v of inner.vertices) {
            if (pointInPolygon(v, outer)) insideCount++;
        }
        return insideCount === inner.size;
    }

    function polygonInsidePolygon(inner, outer) {
        return isPolygonInside(inner, outer);
    }

    // Сброс счётчика
    function resetCounter() { counter.reset(); }
    function getCounter() { return counter; }

    // Экспорт
    global.ClipAlgo = {
        OpCounter,
        sutherlandCohen,
        liangBarsky,
        midpointSubdivision,
        cyrusBeck,
        weilerAtherton,
        greinerHormann,
        resetCounter,
        getCounter
    };

})(window);
