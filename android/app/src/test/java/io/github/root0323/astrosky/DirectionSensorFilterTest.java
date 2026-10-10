package io.github.root0323.astrosky;
import org.junit.Test;
import static org.junit.Assert.*;
public class DirectionSensorFilterTest {
    @Test public void filtersNoiseAndRestartsFresh() {
        DirectionSensorFilter f = new DirectionSensorFilter();
        assertArrayEquals(new float[]{0,0,10}, f.update(new float[]{0,0,10}, 1), 0);
        float[] filtered = f.update(new float[]{1,0,9}, 33_000_001);
        assertTrue(filtered[0] > 0 && filtered[0] < 0.4);
        filtered[0] = 999;
        assertTrue(f.update(new float[]{1,0,9}, 66_000_001)[0] < 1);
        f.reset();
        assertArrayEquals(new float[]{-1,2,3}, f.update(new float[]{-1,2,3}, 70_000_001), 0);
    }
    @Test public void resumesWithoutDraggingOldOrientation() {
        DirectionSensorFilter f = new DirectionSensorFilter();
        f.update(new float[]{0,0,10}, 1);
        assertArrayEquals(new float[]{10,0,0}, f.update(new float[]{10,0,0}, 2_000_000_001L), 0);
    }
}
