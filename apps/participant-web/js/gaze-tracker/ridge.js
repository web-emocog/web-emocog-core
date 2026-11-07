/**
 * Модуль ridge-регрессии
 * Решает w = (X^T X + λI)^{-1} X^T y методом Гаусса
 * с частичным выбором ведущего элемента.
 * 
 * @module gaze-tracker/ridge
 */

/**
 * Транспонирует матрицу.
 * @param {number[][]} M - входная матрица (m × n)
 * @returns {number[][]} транспонированная матрица (n × m)
 */
function transpose(M) {
    const rows = M.length;
    const cols = M[0].length;
    const T = [];
    for (let j = 0; j < cols; j++) {
        T[j] = new Array(rows);
        for (let i = 0; i < rows; i++) {
            T[j][i] = M[i][j];
        }
    }
    return T;
}

/**
 * Перемножает матрицы A (m×n) × B (n×p) → C (m×p).
 */
function matMul(A, B) {
    const m = A.length;
    const n = A[0].length;
    const p = B[0].length;
    const C = [];
    for (let i = 0; i < m; i++) {
        C[i] = new Array(p).fill(0);
        for (let j = 0; j < p; j++) {
            for (let k = 0; k < n; k++) {
                C[i][j] += A[i][k] * B[k][j];
            }
        }
    }
    return C;
}

/**
 * Решает Ax = b методом Гаусса с частичным выбором ведущего.
 * @param {number[][]} A - квадратная матрица (n × n)
 * @param {number[]} b - правая часть (n)
 * @returns {number[]} вектор решения (n)
 */
function solveLinearSystem(A, b) {
    const n = A.length;
    const M = A.map(row => [...row]);
    const rhs = [...b];

    // Прямой ход
    for (let col = 0; col < n; col++) {
        // Частичный выбор ведущего
        let maxRow = col;
        let maxVal = Math.abs(M[col][col]);
        for (let row = col + 1; row < n; row++) {
            if (Math.abs(M[row][col]) > maxVal) {
                maxVal = Math.abs(M[row][col]);
                maxRow = row;
            }
        }
        if (maxRow !== col) {
            [M[col], M[maxRow]] = [M[maxRow], M[col]];
            [rhs[col], rhs[maxRow]] = [rhs[maxRow], rhs[col]];
        }

        const pivot = M[col][col];
        if (Math.abs(pivot) < 1e-12) {
            console.warn('[RidgeRegression] Degenerate matrix');
            return new Array(n).fill(0);
        }

        for (let row = col + 1; row < n; row++) {
            const factor = M[row][col] / pivot;
            for (let j = col; j < n; j++) {
                M[row][j] -= factor * M[col][j];
            }
            rhs[row] -= factor * rhs[col];
        }
    }

    // Обратный ход
    const x = new Array(n).fill(0);
    for (let row = n - 1; row >= 0; row--) {
        let sum = rhs[row];
        for (let j = row + 1; j < n; j++) {
            sum -= M[row][j] * x[j];
        }
        x[row] = sum / M[row][row];
    }

    return x;
}

/**
 * Выполняет ridge-регрессию: w = (X^T X + λI)^{-1} X^T y
 * @param {number[][]} X - матрица признаков (n × d)
 * @param {number[]} y - целевые значения (n)
 * @param {number} lambda - коэффициент регуляризации
 * @returns {number[]} вектор весов (d)
 */
export function ridgeRegression(X, y, lambda) {
    const n = X.length;
    const d = X[0].length;

    // X^T X  (d × d)
    const XtX = matMul(transpose(X), X);

    // + λI (но НЕ для bias-столбца — интерсепт не регуляризуем)
    for (let i = 0; i < d; i++) {
        if (i < d - 1) { // пропускаем bias-столбец (последний)
            XtX[i][i] += lambda;
        }
    }

    // X^T y  (d × 1)
    const Xty = new Array(d).fill(0);
    for (let j = 0; j < d; j++) {
        for (let i = 0; i < n; i++) {
            Xty[j] += X[i][j] * y[i];
        }
    }

    return solveLinearSystem(XtX, Xty);
}

// Dual form for the local high-dimensional eye-patch experiment. Centering
// keeps the intercept unpenalized; the production iris fit above is unchanged.
export function ridgeRegressionDual(X, y, lambda) {
    const n = X?.length, d = X?.[0]?.length;
    if (!(n >= 2 && d >= 2) || y?.length !== n || !Number.isFinite(lambda) || lambda <= 0
        || !y.every(Number.isFinite) || !X.every(row => Array.isArray(row) && row.length === d
            && row[d - 1] === 1 && row.every(Number.isFinite))) return null;
    const meanX = Array.from({ length: d - 1 }, (_, j) => X.reduce((s, row) => s + row[j], 0) / n);
    const meanY = y.reduce((s, value) => s + value, 0) / n;
    const centered = X.map(row => meanX.map((mean, j) => row[j] - mean));
    const gram = centered.map((a, i) => centered.map((b, j) =>
        a.reduce((sum, value, k) => sum + value * b[k], i === j ? lambda : 0)));
    const alpha = solveLinearSystem(gram, y.map(value => value - meanY));
    const weights = meanX.map((_, j) => centered.reduce((s, row, i) => s + row[j] * alpha[i], 0));
    weights.push(meanY - weights.reduce((sum, value, j) => sum + value * meanX[j], 0));
    return weights.every(Number.isFinite) ? weights : null;
}

/**
 * Скалярное произведение двух векторов.
 */
export function dotProduct(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        sum += a[i] * (b[i] || 0);
    }
    return sum;
}
