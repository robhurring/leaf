use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use leaf_app::idle::IdleGuard;

fn counter() -> (Arc<AtomicUsize>, Arc<dyn Fn() + Send + Sync>) {
    let n = Arc::new(AtomicUsize::new(0));
    let m = n.clone();
    (
        n,
        Arc::new(move || {
            m.fetch_add(1, Ordering::SeqCst);
        }),
    )
}

#[tokio::test(start_paused = true)]
async fn with_no_client_ever_it_fires_once_after_the_startup_grace() {
    let (fired, on_idle) = counter();
    let _g = IdleGuard::new(
        Duration::from_millis(5000),
        Duration::from_millis(100),
        on_idle,
    );
    tokio::time::sleep(Duration::from_millis(4999)).await;
    assert_eq!(fired.load(Ordering::SeqCst), 0);
    tokio::time::sleep(Duration::from_millis(2)).await;
    assert_eq!(fired.load(Ordering::SeqCst), 1);
    tokio::time::sleep(Duration::from_millis(60_000)).await;
    assert_eq!(fired.load(Ordering::SeqCst), 1);
}

#[tokio::test(start_paused = true)]
async fn a_client_holds_it_and_the_last_tab_closing_fires_after_the_idle_grace() {
    let (fired, on_idle) = counter();
    let g = IdleGuard::new(
        Duration::from_millis(5000),
        Duration::from_millis(100),
        on_idle,
    );
    g.clients(1);
    tokio::time::sleep(Duration::from_millis(60_000)).await;
    assert_eq!(fired.load(Ordering::SeqCst), 0);
    g.clients(2);
    g.clients(1);
    g.clients(0);
    tokio::time::sleep(Duration::from_millis(50)).await;
    g.clients(1);
    tokio::time::sleep(Duration::from_millis(60_000)).await;
    assert_eq!(fired.load(Ordering::SeqCst), 0);
    g.clients(0);
    tokio::time::sleep(Duration::from_millis(99)).await;
    assert_eq!(fired.load(Ordering::SeqCst), 0);
    tokio::time::sleep(Duration::from_millis(2)).await;
    assert_eq!(fired.load(Ordering::SeqCst), 1);
}

#[tokio::test(start_paused = true)]
async fn idle_zero_means_never_and_stop_cancels() {
    let (fired, on_idle) = counter();
    let _g = IdleGuard::new(Duration::from_millis(5000), Duration::ZERO, on_idle.clone());
    tokio::time::sleep(Duration::from_secs(100_000)).await;
    assert_eq!(fired.load(Ordering::SeqCst), 0);
    let g = IdleGuard::new(
        Duration::from_millis(100),
        Duration::from_millis(100),
        on_idle,
    );
    g.stop();
    tokio::time::sleep(Duration::from_millis(1000)).await;
    assert_eq!(fired.load(Ordering::SeqCst), 0);
}
