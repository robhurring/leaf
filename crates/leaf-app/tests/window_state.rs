// Where a new window goes: where that file or folder's window last was, else the last
// window's size, stepped down and right so windows don't stack exactly; never off-screen.
use leaf_app::window_state::{Geometry, Rect, WindowStates};
use std::path::Path;

const SCREEN: Rect = Rect {
    x: 0.0,
    y: 0.0,
    width: 1728.0,
    height: 1117.0,
};
fn g(x: f64, y: f64, w: f64, h: f64) -> Geometry {
    Geometry {
        x,
        y,
        width: w,
        height: h,
        maximized: false,
    }
}

#[test]
fn a_path_reopens_where_its_window_last_was() {
    let mut s = WindowStates::default();
    s.record(Path::new("/code/relay"), g(100.0, 80.0, 1200.0, 800.0));
    assert_eq!(
        s.place(Path::new("/code/relay"), &[], &[SCREEN]),
        Some(g(100.0, 80.0, 1200.0, 800.0))
    );
}

#[test]
fn a_new_path_takes_the_last_size_stepped_from_open_windows() {
    let mut s = WindowStates::default();
    assert_eq!(
        s.place(Path::new("/a"), &[], &[SCREEN]),
        None,
        "nothing known: the default"
    );
    s.record(Path::new("/a"), g(100.0, 80.0, 1200.0, 800.0));
    // Nothing open: the last window's spot.
    assert_eq!(
        s.place(Path::new("/b"), &[], &[SCREEN]),
        Some(g(100.0, 80.0, 1200.0, 800.0))
    );
    // A window there already: step down and right, past every window in the way.
    let open = [
        g(100.0, 80.0, 1200.0, 800.0),
        g(128.0, 108.0, 1200.0, 800.0),
    ];
    assert_eq!(
        s.place(Path::new("/b"), &open, &[SCREEN]),
        Some(g(156.0, 136.0, 1200.0, 800.0))
    );
    // A known path also steps aside when its spot is taken (a second window on it).
    assert_eq!(
        s.place(Path::new("/a"), &open[..1], &[SCREEN]),
        Some(g(128.0, 108.0, 1200.0, 800.0))
    );
}

#[test]
fn off_screen_spots_keep_their_size_but_not_their_position() {
    let mut s = WindowStates::default();
    // A monitor that's gone: the window was on a second screen to the right.
    s.record(Path::new("/a"), g(2000.0, 100.0, 1200.0, 800.0));
    let placed = s.place(Path::new("/a"), &[], &[SCREEN]).unwrap();
    assert_eq!((placed.width, placed.height), (1200.0, 800.0));
    assert!(
        placed.x >= 0.0 && placed.x + placed.width <= SCREEN.width,
        "{placed:?}"
    );
    assert!(
        placed.y >= 0.0 && placed.y + placed.height <= SCREEN.height,
        "{placed:?}"
    );
    // Bigger than the screen now: shrunk to fit.
    s.record(Path::new("/big"), g(0.0, 0.0, 3000.0, 2000.0));
    let big = s.place(Path::new("/big"), &[], &[SCREEN]).unwrap();
    assert!(
        big.width <= SCREEN.width && big.height <= SCREEN.height,
        "{big:?}"
    );
}

#[test]
fn saved_and_loaded_as_json() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("windows.json");
    let mut s = WindowStates::default();
    s.record(
        Path::new("/a"),
        Geometry {
            maximized: true,
            ..g(10.0, 20.0, 900.0, 700.0)
        },
    );
    s.save(&file).unwrap();
    let back = WindowStates::load(&file);
    assert!(
        back.place(Path::new("/a"), &[], &[SCREEN])
            .unwrap()
            .maximized
    );
    // A missing or broken file is just no memory.
    std::fs::write(&file, "{nope").unwrap();
    assert_eq!(
        WindowStates::load(&file).place(Path::new("/a"), &[], &[SCREEN]),
        None
    );
}
