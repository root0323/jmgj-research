package io.github.root0323.astrosky;

/** Smooth the fallback accelerometer/magnetometer without changing device axes. */
public final class DirectionSensorFilter {
    private float[] value;
    private long timestamp;
    public void reset() { value = null; timestamp = 0; }
    public float[] update(float[] next, long time) {
        if (value == null || time <= timestamp || time - timestamp > 1_000_000_000L) value = new float[]{next[0], next[1], next[2]};
        else {
            double blend = 1 - Math.exp(-(time - timestamp) / 100_000_000.0);
            for (int i = 0; i < 3; i++) value[i] += (next[i] - value[i]) * blend;
        }
        timestamp = time;
        return value.clone();
    }
}
