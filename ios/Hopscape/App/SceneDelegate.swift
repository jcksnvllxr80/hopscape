import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = RootViewController()
        self.window = window
        window.makeKeyAndVisible()
    }

    // window.addEventListener('blur', ...) — losing focus pauses a running game
    func sceneWillResignActive(_ scene: UIScene) {
        (window?.rootViewController as? RootViewController)?.handleWindowBlur()
    }
}
