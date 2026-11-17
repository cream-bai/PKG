/**
 * ============================================================
 * geometry.js — Базовые геометрические примитивы и операции
 * Содержит: точки, отрезки, полигоны, векторная алгебра,
 * операции с плавающей точкой с ε-устойчивостью
 * ============================================================
 */

// ═══════════════════════════════════════════════════════════
//  КОНСТАНТЫ И УТИЛИТЫ
// ═══════════════════════════════════════════════════════════

const EPS = 1e-7;        // Точность геометрических сравнений
const EPS2 = 1e-10;      // Сверхмалая точность для знаков
const INF = 1e18;        // Бесконечность

// ε-сравнение чисел с плавающей точкой
function eq(a, b, eps = EPS)  { return Math.abs(a - b) < eps; }
function neq(a, b, eps = EPS) { return Math.abs(a - b) >= eps; }
function lt(a, b, eps = EPS)  { return a < b - eps; }
function lte(a, b, eps = EPS) { return a <= b + eps; }
function gt(a, b, eps = EPS)  { return a > b + eps; }
function gte(a, b, eps = EPS) { return a >= b - eps; }

// Округление до заданной точности
function roundEps(val, eps = EPS) {
    const inv = 1 / eps;
    return Math.round(val * inv) / inv;
}

// ═══════════════════════════════════════════════════════════
//  КЛАСС Point — двумерная точка
// ═══════════════════════════════════════════════════════════

class Point {
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }

    clone() {
        return new Point(this.x, this.y);
    }

    add(p)  { return new Point(this.x + p.x, this.y + p.y); }
    sub(p)  { return new Point(this.x - p.x, this.y - p.y); }
    mul(s)  { return new Point(this.x * s, this.y * s); }
    div(s)  { return new Point(this.x / s, this.y / s); }

    dot(p)  { return this.x * p.x + this.y * p.y; }         // Скалярное произведение
    cross(p){ return this.x * p.y - this.y * p.x; }         // Векторное произведение (псевдоскаляр)
    len()   { return Math.hypot(this.x, this.y); }          // Длина вектора
    lenSq() { return this.x * this.x + this.y * this.y; }   // Квадрат длины

    // Нормализованный вектор
    normalize() {
        const l = this.len();
        if (l < EPS) return new Point(0, 0);
        return new Point(this.x / l, this.y / l);
    }

    // Расстояние до точки
    distTo(p) { return Math.hypot(this.x - p.x, this.y - p.y); }

    // Перпендикулярный вектор (поворот на 90°)
    perp() { return new Point(-this.y, this.x); }

    equals(p, eps = EPS) {
        return eq(this.x, p.x, eps) && eq(this.y, p.y, eps);
    }

    toString(prec = 2) {
        return `(${this.x.toFixed(prec)}, ${this.y.toFixed(prec)})`;
    }
}

// ═══════════════════════════════════════════════════════════
//  КЛАСС Vec2 — псевдоним Point для векторных операций
// ═══════════════════════════════════════════════════════════

const Vec2 = Point;

// ═══════════════════════════════════════════════════════════
//  КЛАСС Line — прямая/отрезок
// ═══════════════════════════════════════════════════════════

class Line {
    constructor(x1, y1, x2, y2, id = null) {
        this.p1 = new Point(x1, y1);
        this.p2 = new Point(x2, y2);
        this.id = id;
        this.color = null;
        this.visible = true;       // Видимая часть после отсечения
        this.clippedResult = null; // Результат отсечения
        this.opCount = { mul: 0, div: 0, add: 0, cmp: 0 }; // Статистика операций
    }

    clone() {
        const l = new Line(this.p1.x, this.p1.y, this.p2.x, this.p2.y, this.id);
        l.color = this.color;
        l.visible = this.visible;
        if (this.clippedResult) {
            l.clippedResult = new Line(
                this.clippedResult.p1.x, this.clippedResult.p1.y,
                this.clippedResult.p2.x, this.clippedResult.p2.y
            );
        }
        return l;
    }

    // Явное уравнение прямой: Ax + By + C = 0
    // Возвращает {A, B, C}
    implicit() {
        const A = this.p2.y - this.p1.y;
        const B = this.p1.x - this.p2.x;
        const C = -(A * this.p1.x + B * this.p1.y);
        return { A, B, C };
    }

    // Параметрическое представление: P(t) = P1 + t * (P2 - P1), t ∈ [0, 1]
    direction() {
        return new Point(this.p2.x - this.p1.x, this.p2.y - this.p1.y);
    }

    // Длина отрезка
    length() {
        return this.p1.distTo(this.p2);
    }

    // Отрезок нулевой длины
    isPoint(eps = EPS) {
        return this.p1.distTo(this.p2) < eps;
    }

    // Координаты отрезка
    get coords() {
        return [this.p1.x, this.p1.y, this.p2.x, this.p2.y];
    }

    toString() {
        return `[${this.id !== null ? this.id : '?'}] ${this.p1.toString()} → ${this.p2.toString()}`;
    }
}

// ═══════════════════════════════════════════════════════════
//  КЛАСС Rect — прямоугольник (отсекающее окно)
// ═══════════════════════════════════════════════════════════

class Rect {
    constructor(xmin, ymin, xmax, ymax) {
        this.xmin = Math.min(xmin, xmax);
        this.ymin = Math.min(ymin, ymax);
        this.xmax = Math.max(xmin, xmax);
        this.ymax = Math.max(ymin, ymax);
    }

    // Вершины по часовой стрелке (для Cyrus-Beck и полигонов)
    vertices() {
        return [
            new Point(this.xmin, this.ymin), // LB
            new Point(this.xmax, this.ymin), // RB
            new Point(this.xmax, this.ymax), // RT
            new Point(this.xmin, this.ymax)  // LT
        ];
    }

    // Рёбра (как отрезки)
    edges() {
        const v = this.vertices();
        return [
            new Line(v[0].x, v[0].y, v[1].x, v[1].y),
            new Line(v[1].x, v[1].y, v[2].x, v[2].y),
            new Line(v[2].x, v[2].y, v[3].x, v[3].y),
            new Line(v[3].x, v[3].y, v[0].x, v[0].y)
        ];
    }

    // Нормали рёбер (направлены ВНУТРЬ окна)
    normals() {
        const v = this.vertices();
        return [
            v[1].sub(v[0]).perp(), // Вниз -> внутрь (вверх)
            v[2].sub(v[1]).perp(), // Вправо -> внутрь (влево)
            v[3].sub(v[2]).perp(), // Вверх -> внутрь (вниз)
            v[0].sub(v[3]).perp()  // Влево -> внутрь (вправо)
        ];
    }

    // Внутренняя нормаль для i-й грани (Cyrus-Beck)
    inwardNormal(i) {
        const n = this.normals()[i];
        return n.normalize();
    }

    width()  { return this.xmax - this.xmin; }
    height() { return this.ymax - this.ymin; }

    // Точка внутри прямоугольника (включая границу)
    contains(p) {
        return gte(p.x, this.xmin) && lte(p.x, this.xmax) &&
               gte(p.y, this.ymin) && lte(p.y, this.ymax);
    }

    // AABB пересекает/содержит точку
    containsAABB(x, y) {
        return x >= this.xmin && x <= this.xmax && y >= this.ymin && y <= this.ymax;
    }

    // Прямоугольник содержит/пересекает другой AABB
    intersectsAABB(other) {
        return !(other.xmax < this.xmin || other.xmin > this.xmax ||
                 other.ymax < this.ymin || other.ymin > this.ymax);
    }

    // Полностью содержит AABB
    containsAABBRect(other) {
        return other.xmin >= this.xmin && other.xmax <= this.xmax &&
               other.ymin >= this.ymin && other.ymax <= this.ymax;
    }

    toString() {
        return `[${this.xmin.toFixed(1)}, ${this.ymin.toFixed(1)}] × [${this.xmax.toFixed(1)}, ${this.ymax.toFixed(1)}]`;
    }
}

// ═══════════════════════════════════════════════════════════
//  КЛАСС Polygon — многоугольник
// ═══════════════════════════════════════════════════════════

class Polygon {
    constructor(vertices = [], id = null) {
        this.vertices = vertices.map(v =>
            v instanceof Point ? v.clone() : new Point(v[0], v[1])
        );
        this.id = id;
        this.color = null;
        this.clippedResult = null; // Массив полигонов-результатов
        this.visible = true;
    }

    clone() {
        return new Polygon(this.vertices.map(v => v.clone()), this.id);
    }

    // Количество вершин
    get size() { return this.vertices.length; }

    // Замкнут ли полигон (первая == последней)
    isClosed() {
        if (this.size < 3) return false;
        return this.vertices[0].equals(this.vertices[this.size - 1]);
    }

    // Замкнуть полигон (добавить первую вершину в конец)
    closedVertices() {
        if (this.isClosed()) return this.vertices;
        return [...this.vertices, this.vertices[0]];
    }

    // Рёбра полигона (отрезки между последовательными вершинами)
    edges() {
        const v = this.closedVertices();
        const edges = [];
        for (let i = 0; i < v.length - 1; i++) {
            edges.push(new Line(v[i].x, v[i].y, v[i + 1].x, v[i + 1].y));
        }
        return edges;
    }

    // Площадь через формулу Гаусса (со знаком)
    signedArea() {
        let area = 0;
        for (let i = 0; i < this.size; i++) {
            const j = (i + 1) % this.size;
            area += this.vertices[i].x * this.vertices[j].y;
            area -= this.vertices[j].x * this.vertices[i].y;
        }
        return area / 2;
    }

    area() { return Math.abs(this.signedArea()); }

    // Ориентация: true = CCW (против часовой), false = CW
    isCCW() {
        return this.signedArea() > 0;
    }

    // AABB полигона
    bounds() {
        let xmin = INF, ymin = INF, xmax = -INF, ymax = -INF;
        for (const v of this.vertices) {
            xmin = Math.min(xmin, v.x);
            ymin = Math.min(ymin, v.y);
            xmax = Math.max(xmax, v.x);
            ymax = Math.max(ymax, v.y);
        }
        return new Rect(xmin, ymin, xmax, ymax);
    }

    // Центр тяжести
    centroid() {
        let cx = 0, cy = 0;
        for (const v of this.vertices) {
            cx += v.x;
            cy += v.y;
        }
        const n = Math.max(1, this.size);
        return new Point(cx / n, cy / n);
    }

    toString() {
        const v = this.vertices.map(p => p.toString()).join(', ');
        return `[${this.id !== null ? this.id : '?'}] ${v}`;
    }
}

// ═══════════════════════════════════════════════════════════
//  БАЗОВЫЕ ГЕОМЕТРИЧЕСКИЕ ОПЕРАЦИИ
// ═══════════════════════════════════════════════════════════

// Пересечение двух прямых (явное задание)
// Возвращает точку или null, если параллельны
function lineIntersection(line1, line2) {
    const { A: A1, B: B1, C: C1 } = line1.implicit();
    const { A: A2, B: B2, C: C2 } = line2.implicit();

    const det = A1 * B2 - A2 * B1;
    if (Math.abs(det) < EPS2) return null; // Параллельны

    const x = (B1 * C2 - B2 * C1) / det;
    const y = (A2 * C1 - A1 * C2) / det;
    return new Point(x, y);
}

// Пересечение отрезка с прямой
function segmentLineIntersection(seg, line) {
    const { A, B, C } = line.implicit();
    const f1 = A * seg.p1.x + B * seg.p1.y + C;
    const f2 = A * seg.p2.x + B * seg.p2.y + C;

    if (eq(f1, 0, EPS)) return seg.p1.clone();
    if (eq(f2, 0, EPS)) return seg.p2.clone();

    if (f1 * f2 > EPS) return null; // Оба конца по одну сторону

    const t = f1 / (f1 - f2);
    return new Point(
        seg.p1.x + t * (seg.p2.x - seg.p1.x),
        seg.p1.y + t * (seg.p2.y - seg.p1.y)
    );
}

// Точка P лежит на отрезке AB (включая концы)
function pointOnSegment(P, A, B) {
    const cross = (P.x - A.x) * (B.y - A.y) - (P.y - A.y) * (B.x - A.x);
    if (Math.abs(cross) > EPS) return false;

    const dot = (P.x - A.x) * (B.x - A.x) + (P.y - A.y) * (B.y - A.y);
    if (dot < -EPS) return false;

    const lenSq = (B.x - A.x) ** 2 + (B.y - A.y) ** 2;
    return dot <= lenSq + EPS;
}

// Пересечение двух отрезков
// Возвращает: { point: Point, type: 'proper'|'vertex'|'collinear' } или null
function segmentIntersection(seg1, seg2) {
    const p1 = seg1.p1, p2 = seg1.p2;
    const p3 = seg2.p1, p4 = seg2.p2;

    const d1 = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
    const d2 = (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);

    if (Math.abs(d1) < EPS2) {
        // Отрезки коллинеарны
        if (Math.abs(d2) < EPS2) {
            // Проверяем перекрытие
            const minX1 = Math.min(p1.x, p2.x), maxX1 = Math.max(p1.x, p2.x);
            const minX2 = Math.min(p3.x, p4.x), maxX2 = Math.max(p3.x, p4.x);
            const minY1 = Math.min(p1.y, p2.y), maxY1 = Math.max(p1.y, p2.y);
            const minY2 = Math.min(p3.y, p4.y), maxY2 = Math.max(p3.y, p4.y);

            if (Math.max(minX1, minX2) <= Math.min(maxX1, maxX2) + EPS &&
                Math.max(minY1, minY2) <= Math.min(maxY1, maxY2) + EPS) {
                // Возвращаем первую общую точку
                const candidates = [p3, p4];
                for (const c of candidates) {
                    if (pointOnSegment(c, p1, p2)) return { point: c.clone(), type: 'collinear' };
                }
                return { point: new Point(Math.max(minX1, minX2), Math.max(minY1, minY2)), type: 'collinear' };
            }
            return null;
        }
        return null; // Параллельны, не коллинеарны
    }

    const t = d2 / d1;
    const s = ((p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x)) / d1;

    if (t >= -EPS && t <= 1 + EPS && s >= -EPS && s <= 1 + EPS) {
        const x = p1.x + t * (p2.x - p1.x);
        const y = p1.y + t * (p2.y - p1.y);
        const type = (eq(t, 0) || eq(t, 1) || eq(s, 0) || eq(s, 1)) ? 'vertex' : 'proper';
        return { point: new Point(x, y), type };
    }

    return null;
}

// Проверка: точка внутри полигона (алгоритм луча)
// rayDir — направление луча (по умолчанию горизонтально вправо)
function pointInPolygon(P, poly, rayDir = new Point(1, 0)) {
    if (poly.size < 3) return false;

    const v = poly.closedVertices();
    let count = 0;

    for (let i = 0; i < v.length - 1; i++) {
        const A = v[i], B = v[i + 1];

        // Пропускаем горизонтальные рёбра
        if (eq(A.y, B.y, EPS)) continue;

        // Точка на вершине
        if (P.equals(A, EPS) || P.equals(B, EPS)) return true;

        // Проверяем, пересекает ли луч ребро
        const ymin = Math.min(A.y, B.y);
        const ymax = Math.max(A.y, B.y);

        if (P.y < ymin - EPS || P.y > ymax + EPS) continue;

        // x координата пересечения луча y=P.y с ребром
        const t = (P.y - A.y) / (B.y - A.y);
        const ix = A.x + t * (B.x - A.x);

        if (ix > P.x + EPS) {
            // Точно на границе
            if (eq(ix, P.x, EPS)) return true;
            count++;
        }
    }

    return count % 2 === 1;
}

// Отрезок целиком внутри полигона
function segmentInsidePolygon(seg, poly) {
    return pointInPolygon(seg.p1, poly) && pointInPolygon(seg.p2, poly);
}

// Ориентированная площадь треугольника (для поворота)
function triangleArea(A, B, C) {
    return (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
}

// Поворот от AB к AC: >0 — левый (CCW), <0 — правый (CW), =0 — коллинеарны
function orient(A, B, C) {
    const area = triangleArea(A, B, C);
    if (Math.abs(area) < EPS2) return 0;
    return area > 0 ? 1 : -1;
}

// Код региона для Сазерленда-Коэна
const CohenCodes = {
    INSIDE: 0,
    LEFT:   1,
    RIGHT:  2,
    BOTTOM: 4,
    TOP:    8
};

function cohenSutherlandCode(P, rect) {
    let code = CohenCodes.INSIDE;
    if (P.x < rect.xmin - EPS)      code |= CohenCodes.LEFT;
    else if (P.x > rect.xmax + EPS) code |= CohenCodes.RIGHT;
    if (P.y < rect.ymin - EPS)      code |= CohenCodes.BOTTOM;
    else if (P.y > rect.ymax + EPS) code |= CohenCodes.TOP;
    return code;
}

// ═══════════════════════════════════════════════════════════
//  ЭКСПОРТ В ГЛОБАЛЬНУЮ ОБЛАСТЬ
// ═══════════════════════════════════════════════════════════

window.Geo = {
    EPS, EPS2, INF,
    eq, neq, lt, lte, gt, gte, roundEps,
    Point, Vec2, Line, Rect, Polygon,
    lineIntersection, segmentLineIntersection,
    pointOnSegment, segmentIntersection,
    pointInPolygon, segmentInsidePolygon,
    triangleArea, orient,
    CohenCodes, cohenSutherlandCode
};
