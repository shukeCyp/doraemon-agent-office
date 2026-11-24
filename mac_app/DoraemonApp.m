#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

@interface AppDelegate : NSObject <NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate>
@property (strong, nonatomic) NSWindow *window;
@property (strong, nonatomic) WKWebView *webView;
@property (strong, nonatomic) NSTask *serverTask;
@property (copy, nonatomic) NSString *projectDir;
@property (strong, nonatomic) NSURL *serverURL;
@end

@implementation AppDelegate

- (instancetype)init {
    self = [super init];
    if (self) {
        NSString *configured = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"DoraemonProjectDir"];
        if (configured && [[NSFileManager defaultManager] fileExistsAtPath:configured]) {
            self.projectDir = configured;
        } else {
            self.projectDir = [NSHomeDirectory() stringByAppendingPathComponent:@"Downloads/doraemon-agent-office"];
        }
        self.serverURL = [NSURL URLWithString:@"http://127.0.0.1:19000/"];
    }
    return self;
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    [self setupMenuBar];
    [self setupWindow];
    [self ensureServerAndLoad];
}

- (void)setupMenuBar {
    NSMenu *mainMenu = [[NSMenu alloc] init];
    NSMenuItem *appMenuItem = [[NSMenuItem alloc] init];
    [mainMenu addItem:appMenuItem];

    NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@"哆啦A梦秘密基地"];
    [appMenu addItemWithTitle:@"全屏屏保模式" action:@selector(toggleFullScreenMode:) keyEquivalent:@"f"];
    [appMenu addItemWithTitle:@"刷新秘密基地" action:@selector(reloadPage:) keyEquivalent:@"r"];
    [appMenu addItemWithTitle:@"在浏览器打开" action:@selector(openInBrowser:) keyEquivalent:@"o"];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:@"退出 哆啦A梦秘密基地" action:@selector(terminate:) keyEquivalent:@"q"];
    [appMenuItem setSubmenu:appMenu];

    [NSApp setMainMenu:mainMenu];
}

- (void)setupWindow {
    NSRect screenFrame = [[NSScreen mainScreen] visibleFrame];
    if (NSIsEmptyRect(screenFrame)) {
        screenFrame = NSMakeRect(0, 0, 1440, 900);
    }
    CGFloat w = MIN(1440.0, screenFrame.size.width * 0.92);
    CGFloat h = MIN(860.0, screenFrame.size.height * 0.90);
    NSRect rect = NSMakeRect(
        NSMidX(screenFrame) - w / 2.0,
        NSMidY(screenFrame) - h / 2.0,
        w, h
    );

    self.window = [[NSWindow alloc] initWithContentRect:rect
                                              styleMask:(NSWindowStyleMaskTitled |
                                                         NSWindowStyleMaskClosable |
                                                         NSWindowStyleMaskMiniaturizable |
                                                         NSWindowStyleMaskResizable)
                                                backing:NSBackingStoreBuffered
                                                  defer:NO];
    self.window.title = @"哆啦A梦 · Antigravity 多Agent秘密基地";
    self.window.collectionBehavior = NSWindowCollectionBehaviorFullScreenPrimary;
    self.window.backgroundColor = [NSColor colorWithCalibratedRed:0.12 green:0.16 blue:0.22 alpha:1.0];

    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    @try {
        [config.preferences setValue:@YES forKey:@"fullScreenEnabled"];
    } @catch (NSException *e) {}

    self.webView = [[WKWebView alloc] initWithFrame:self.window.contentView.bounds configuration:config];
    self.webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    self.webView.UIDelegate = self;
    self.webView.navigationDelegate = self;

    [self.window.contentView addSubview:self.webView];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

- (void)checkServerAlive:(void (^)(BOOL alive))completion {
    NSURL *healthURL = [NSURL URLWithString:@"http://127.0.0.1:19000/api/health"];
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:healthURL];
    req.timeoutInterval = 1.0;
    NSURLSessionDataTask *task = [[NSURLSession sharedSession] dataTaskWithRequest:req
                                                                 completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        BOOL ok = (!error && [(NSHTTPURLResponse *)response statusCode] == 200);
        dispatch_async(dispatch_get_main_queue(), ^{
            completion(ok);
        });
    }];
    [task resume];
}

- (void)ensureServerAndLoad {
    [self checkServerAlive:^(BOOL alive) {
        if (alive) {
            [self.webView loadRequest:[NSURLRequest requestWithURL:self.serverURL]];
        } else {
            [self startBackendProcess];
            [self waitForServerWithRetries:22];
        }
    }];
}

- (void)startBackendProcess {
    NSString *py = [self.projectDir stringByAppendingPathComponent:@".venv/bin/python"];
    NSString *script = [self.projectDir stringByAppendingPathComponent:@"backend/doraemon_app.py"];
    if (![[NSFileManager defaultManager] fileExistsAtPath:py] ||
        ![[NSFileManager defaultManager] fileExistsAtPath:script]) {
        return;
    }
    NSTask *task = [[NSTask alloc] init];
    task.executableURL = [NSURL fileURLWithPath:py];
    task.arguments = @[script];
    task.currentDirectoryURL = [NSURL fileURLWithPath:self.projectDir];
    task.standardOutput = [NSFileHandle fileHandleWithNullDevice];
    task.standardError = [NSFileHandle fileHandleWithNullDevice];
    NSError *err = nil;
    if ([task launchAndReturnError:&err]) {
        self.serverTask = task;
    }
}

- (void)waitForServerWithRetries:(NSInteger)retries {
    if (retries <= 0) {
        [self.webView loadRequest:[NSURLRequest requestWithURL:self.serverURL]];
        return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.35 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        [self checkServerAlive:^(BOOL alive) {
            if (alive) {
                [self.webView loadRequest:[NSURLRequest requestWithURL:self.serverURL]];
            } else {
                [self waitForServerWithRetries:retries - 1];
            }
        }];
    });
}

- (void)toggleFullScreenMode:(id)sender {
    [self.window toggleFullScreen:nil];
}

- (void)reloadPage:(id)sender {
    [self.webView reload];
}

- (void)openInBrowser:(id)sender {
    [[NSWorkspace sharedWorkspace] openURL:self.serverURL];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return YES;
}

- (void)applicationWillTerminate:(NSNotification *)notification {
    if (self.serverTask && self.serverTask.isRunning) {
        [self.serverTask terminate];
    }
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        AppDelegate *delegate = [[AppDelegate alloc] init];
        app.delegate = delegate;
        [app run];
    }
    return 0;
}
