package com.taqati.solar

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(SecureStorePlugin::class.java)
        registerPlugin(MonitorPlugin::class.java)
        registerPlugin(DeviceToolsPlugin::class.java)
        registerPlugin(UpdaterPlugin::class.java)
        super.onCreate(savedInstanceState)
    }

    override fun onResume() {
        super.onResume()
        inForeground = true
    }

    override fun onPause() {
        inForeground = false
        super.onPause()
    }

    companion object {
        /** الفحص في الخلفية يتوقف ما دامت الواجهة ظاهرة لأنها تراقب بنفسها */
        @Volatile
        var inForeground = false
    }
}
