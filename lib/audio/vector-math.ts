/**
 * Vector Mathematics & Cosine Similarity Utilities
 * 
 * Provides pure mathematical operations for 512-dimensional speaker embeddings:
 * - Dot product, Euclidean norm, and L2 unit normalization.
 * - Cosine similarity calculation.
 * - Centroid synthesis and mean pairwise distance calculation.
 */

export class VectorMath {
  /**
   * Computes the dot product of two vectors of equal length.
   */
  public static dot(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
    }
    let sum = 0.0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  /**
   * Computes the Euclidean (L2) norm of a vector.
   */
  public static norm(a: Float32Array): number {
    return Math.sqrt(this.dot(a, a));
  }

  /**
   * Returns a new L2 unit-normalized vector: ||v||_2 = 1.0.
   */
  public static normalize(a: Float32Array): Float32Array {
    const magnitude = this.norm(a);
    if (magnitude === 0 || !Number.isFinite(magnitude)) {
      throw new Error("Cannot normalize zero-magnitude or non-finite vector.");
    }
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) {
      out[i] = a[i] / magnitude;
    }
    return out;
  }

  /**
   * Computes cosine similarity between two vectors:
   * cos(theta) = (a . b) / (||a|| * ||b||)
   * If both vectors are already unit-normalized, cos(theta) = a . b.
   */
  public static cosineSimilarity(a: Float32Array, b: Float32Array): number {
    const dotProduct = this.dot(a, b);
    const magA = this.norm(a);
    const magB = this.norm(b);
    if (magA === 0 || magB === 0) return 0.0;
    const sim = dotProduct / (magA * magB);
    // Clamp to floating-point range [-1.0, 1.0]
    return Math.max(-1.0, Math.min(1.0, sim));
  }

  /**
   * Computes the arithmetic centroid of multiple vectors, re-normalized to unit sphere.
   */
  public static computeCentroid(vectors: readonly Float32Array[]): Float32Array {
    if (!vectors || vectors.length === 0) {
      throw new Error("Cannot compute centroid of empty vector set.");
    }
    const dim = vectors[0].length;
    const centroid = new Float32Array(dim);

    for (const v of vectors) {
      if (v.length !== dim) {
        throw new Error(`Vector dimension mismatch: expected ${dim}, got ${v.length}`);
      }
      for (let i = 0; i < dim; i++) {
        centroid[i] += v[i];
      }
    }

    for (let i = 0; i < dim; i++) {
      centroid[i] /= vectors.length;
    }

    return this.normalize(centroid);
  }

  /**
   * Computes the NxN pairwise cosine similarity matrix across an array of vectors.
   */
  public static pairwiseSimilarities(vectors: readonly Float32Array[]): number[][] {
    const n = vectors.length;
    const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      matrix[i][i] = 1.0;
      for (let j = i + 1; j < n; j++) {
        const sim = this.cosineSimilarity(vectors[i], vectors[j]);
        matrix[i][j] = sim;
        matrix[j][i] = sim;
      }
    }
    return matrix;
  }
}
