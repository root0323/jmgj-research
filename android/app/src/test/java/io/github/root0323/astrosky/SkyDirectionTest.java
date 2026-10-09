package io.github.root0323.astrosky;
import org.junit.Test;
import static org.junit.Assert.*;
public class SkyDirectionTest {
    @Test public void backCameraPointsNorth() { assertArrayEquals(new double[]{0, 0}, SkyDirection.fromMatrix(new float[]{1,0,0, 0,0,-1, 0,1,0}, 0), 1e-6); }
    @Test public void eastWestAndDeclination() {
        assertArrayEquals(new double[]{90, 0}, SkyDirection.fromMatrix(new float[]{0,0,-1, 1,0,0, 0,1,0}, 0), 1e-6);
        assertArrayEquals(new double[]{270, 0}, SkyDirection.fromMatrix(new float[]{0,0,1, -1,0,0, 0,1,0}, 0), 1e-6);
        assertEquals(354, SkyDirection.fromMatrix(new float[]{1,0,0, 0,0,-1, 0,1,0}, -6)[0], 1e-6);
    }
    @Test public void faceDownShowsZenith() { assertEquals(90, SkyDirection.fromMatrix(new float[]{1,0,0,0,-1,0,0,0,-1}, 0)[1], 1e-6); }
}
