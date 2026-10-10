package io.github.root0323.astrosky;

/** Back camera (-device Z) in Android's east/north/up rotation matrix. */
public final class SkyDirection {
    public static double[] fromMatrix(float[] matrix, double declination) {
        double east = -matrix[2], north = -matrix[5], up = -matrix[8];
        double altitude = Math.toDegrees(Math.asin(Math.max(-1, Math.min(1, up))));
        double azimuth = (Math.toDegrees(Math.atan2(east, north)) + declination + 720) % 360;
        return new double[] { azimuth, altitude };
    }
    private SkyDirection() { }
}
