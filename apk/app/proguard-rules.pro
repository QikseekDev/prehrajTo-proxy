# Wflix – pravidla pro R8.
# Metody dostupné z JavaScriptu (window.WflixNative) se nesmí přejmenovat ani odstranit.
-keepattributes JavascriptInterface,Signature,*Annotation*
-keepclassmembers class cz.qikseek.wflix.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
