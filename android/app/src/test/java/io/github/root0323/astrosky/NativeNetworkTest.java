package io.github.root0323.astrosky;
import java.net.URL;
import org.junit.Test;
import static org.junit.Assert.*;
public class NativeNetworkTest {
    @Test public void onlyApprovedDataHostsAndPaths() throws Exception {
        assertTrue(NativeNetwork.permitted(new URL("https://www.7timer.info/bin/api.pl?lat=33&lon=126&product=astro&output=json"), false));
        assertTrue(NativeNetwork.permitted(new URL("https://my.meteoblue.com/packages/clouds-3h?apikey=test"), false));
        assertFalse(NativeNetwork.permitted(new URL("https://my.meteoblue.com/account/delete"), false));
        assertFalse(NativeNetwork.permitted(new URL("https://www.7timer.info.attacker.test/bin/api.pl"), false));
        assertFalse(NativeNetwork.permitted(new URL("https://name:password@www.7timer.info/bin/api.pl"), false));
        assertFalse(NativeNetwork.permitted(new URL("http://www.7timer.info/bin/api.pl"), false));
        assertFalse(NativeNetwork.permitted(new URL("https://www.7timer.info:444/bin/api.pl"), false));
        assertFalse(NativeNetwork.permitted(new URL("https://copernicus-dem-90m.s3.amazonaws.com/arbitrary"), true));
        assertTrue(NativeNetwork.permitted(new URL("https://copernicus-dem-90m.s3.amazonaws.com/tileList.txt"), true));
    }
}
