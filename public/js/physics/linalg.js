// Small dense linear algebra helpers. Matrices are arrays of row arrays.

// Solve A x = b with Gaussian elimination and partial pivoting.
// Returns null when A is singular.
export function solve(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-14) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x;
}

// Inverse of a small square matrix, or null when singular.
export function invert(A) {
  const n = A.length;
  const cols = [];
  for (let i = 0; i < n; i++) {
    const e = new Array(n).fill(0);
    e[i] = 1;
    const c = solve(A, e);
    if (!c) return null;
    cols.push(c);
  }
  return A.map((_, r) => cols.map((c) => c[r]));
}

// Weighted linear least squares: minimise sum w_i (y_i - X_i . beta)^2.
// Returns { beta, cov, rmse, residuals } where cov is the parameter covariance.
export function leastSquares(X, y, w) {
  const n = X.length;
  const p = X[0].length;
  const weights = w || new Array(n).fill(1);
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const wi = weights[i];
    for (let a = 0; a < p; a++) {
      Xty[a] += wi * X[i][a] * y[i];
      for (let b = 0; b < p; b++) XtX[a][b] += wi * X[i][a] * X[i][b];
    }
  }
  const beta = solve(XtX, Xty);
  if (!beta) return null;
  const residuals = y.map((yi, i) => yi - X[i].reduce((s, xij, j) => s + xij * beta[j], 0));
  let ss = 0;
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    ss += weights[i] * residuals[i] ** 2;
    wsum += weights[i];
  }
  const dof = Math.max(1, n - p);
  const sigma2 = ss / dof;
  const inv = invert(XtX);
  const cov = inv ? inv.map((row) => row.map((v) => v * sigma2)) : null;
  return { beta, cov, residuals, rmse: Math.sqrt(ss / Math.max(1e-12, wsum)) };
}
